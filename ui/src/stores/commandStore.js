import { create } from "zustand";
import { useAuthStore } from "./authStore";

const API_BASE = import.meta.env.PROD ? "https://connect.chitty.cc" : "";
const PATTERNS_KEY = "chittycommand_patterns";
const PREFS_KEY = "chittycommand_prefs";

// Authenticated fetch that actually works (dashboardStore's version has a recursion bug)
async function apiFetch(path, options = {}) {
  const authHeaders = useAuthStore.getState().getAuthHeaders();
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...authHeaders, ...options.headers },
  });
  if (response.status === 401) {
    useAuthStore.getState().logout();
  }
  return response;
}

async function apiJson(path, options = {}) {
  const res = await apiFetch(path, options);
  const data = await res.json();
  if (!data.success) throw new Error(data.error || "API error");
  return data.data;
}

function loadPatterns() {
  try {
    return JSON.parse(localStorage.getItem(PATTERNS_KEY)) || defaultPatterns();
  } catch {
    return defaultPatterns();
  }
}

function savePatterns(patterns) {
  localStorage.setItem(PATTERNS_KEY, JSON.stringify(patterns));
}

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || defaultPrefs();
  } catch {
    return defaultPrefs();
  }
}

function savePrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function defaultPatterns() {
  return {
    failureCounts: {},      // slug -> count of failures observed
    failureTimes: {},       // slug -> [timestamps of failures]
    recoveryTimes: {},      // slug -> [ms it took to recover]
    coFailures: {},         // "slug1|slug2" -> count of simultaneous failures
    credentialRefreshes: {},// slug -> [timestamps of credential refreshes]
    healAttempts: {},       // slug -> { attempts: N, successes: N }
    lastUpdated: null,
  };
}

function defaultPrefs() {
  return {
    autopilotEnabled: false,
    sweepIntervalMs: 60000,
    autoHealEnabled: true,
    maxHealRetries: 4,
    credentialWarnDays: 7,
  };
}

// Exponential backoff: 10s, 30s, 60s, 120s
function healBackoffMs(attempt) {
  return [10000, 30000, 60000, 120000][Math.min(attempt, 3)];
}

export const useCommandStore = create((set, get) => ({
  // === Core state ===
  connections: [],
  connectionStats: null,
  loading: false,
  error: null,

  // === Autopilot ===
  autopilot: loadPrefs().autopilotEnabled,
  prefs: loadPrefs(),
  sweepTimer: null,
  lastSweep: null,
  sweepRunning: false,

  // === Healing ===
  healQueue: [],       // [{slug, attempt, nextAt}]
  healTimer: null,
  healingSlug: null,   // currently being healed

  // === Intelligence ===
  patterns: loadPatterns(),
  insights: [],
  activityLog: [],     // [{time, type, slug, message}]

  // === API Keys ===
  apiKeys: [],
  apiKeysLoading: false,
  newKeyValue: null,

  // ─────────────────────────────────────────────
  // DATA FETCHING — real API calls
  // ─────────────────────────────────────────────

  fetchAll: async () => {
    set({ loading: true, error: null });
    try {
      const [conns, stats] = await Promise.all([
        apiJson("/api/connections?status=active&sort=tier"),
        apiJson("/api/connections/stats").catch(() => null),
      ]);
      set({
        connections: conns.connections || [],
        connectionStats: stats,
        loading: false,
      });
      get().computeInsights();
    } catch (err) {
      set({ error: err.message, loading: false });
    }
  },

  testOne: async (slug) => {
    const log = get().addLog;
    try {
      const result = await apiJson(`/api/connections/${slug}/test`, { method: "POST" });
      log("test", slug, `Health check: ${result.status} (${result.latency_ms ?? "?"}ms)`);

      // Update local state with new health
      set((s) => ({
        connections: s.connections.map((c) =>
          c.slug === slug
            ? {
                ...c,
                last_health_status: result.status,
                last_health_latency_ms: result.latency_ms,
                last_health_check: new Date().toISOString(),
              }
            : c,
        ),
      }));

      get().recordHealthResult(slug, result);
      return result;
    } catch (err) {
      log("error", slug, `Health check failed: ${err.message}`);
      get().recordFailure(slug);
      return { status: "down", error: err.message };
    }
  },

  testAll: async () => {
    set({ sweepRunning: true });
    const log = get().addLog;
    log("sweep", null, "Starting health sweep");

    try {
      const data = await apiJson("/api/connections/test-all", { method: "POST" });
      log("sweep", null, `Sweep complete: ${data.summary?.healthy ?? "?"}/${data.summary?.total ?? "?"} healthy`);

      // Refresh data after sweep
      await get().fetchAll();

      // Record results for pattern learning
      const { connections } = get();
      const downNow = connections.filter((c) => c.last_health_status === "down").map((c) => c.slug);

      if (downNow.length > 1) {
        get().recordCoFailures(downNow);
      }

      // Trigger healing for anything that's down
      if (get().prefs.autoHealEnabled) {
        for (const slug of downNow) {
          get().enqueueHeal(slug);
        }
      }

      return data;
    } catch (err) {
      log("error", null, `Sweep failed: ${err.message}`);
      return null;
    } finally {
      set({ sweepRunning: false, lastSweep: Date.now() });
    }
  },

  testCredential: async (slug) => {
    const log = get().addLog;
    try {
      const result = await apiJson(`/api/connections/${slug}/credential/test`, { method: "POST" });
      log("credential", slug, `Credential: ${result.available ? "available" : "unavailable"} (${result.source})`);
      return result;
    } catch (err) {
      log("error", slug, `Credential test failed: ${err.message}`);
      return { available: false, source: "error", error: err.message };
    }
  },

  // ─────────────────────────────────────────────
  // API KEYS — real CRUD
  // ─────────────────────────────────────────────

  fetchApiKeys: async () => {
    set({ apiKeysLoading: true });
    try {
      const token = useAuthStore.getState().token;
      if (!token) { set({ apiKeysLoading: false }); return; }
      const res = await fetch(`${API_BASE}/api/auth/keys`, {
        headers: { "X-ChittyOS-API-Key": token },
      });
      const data = await res.json();
      if (data.success) {
        set({ apiKeys: data.data.keys, apiKeysLoading: false });
      } else {
        set({ apiKeysLoading: false });
      }
    } catch {
      set({ apiKeysLoading: false });
    }
  },

  createApiKey: async (name, scopes, expiresAt) => {
    const token = useAuthStore.getState().token;
    if (!token) return false;
    try {
      const res = await fetch(`${API_BASE}/api/auth/keys`, {
        method: "POST",
        headers: { "X-ChittyOS-API-Key": token, "Content-Type": "application/json" },
        body: JSON.stringify({ name, scopes, expiresAt: expiresAt || null }),
      });
      const data = await res.json();
      if (data.success) {
        set({ newKeyValue: data.data.key });
        get().fetchApiKeys();
        get().addLog("key", null, `API key "${name}" created`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  revokeApiKey: async (prefix) => {
    const token = useAuthStore.getState().token;
    if (!token) return false;
    try {
      const res = await fetch(`${API_BASE}/api/auth/keys/${prefix}`, {
        method: "DELETE",
        headers: { "X-ChittyOS-API-Key": token },
      });
      const data = await res.json();
      if (data.success) {
        get().fetchApiKeys();
        get().addLog("key", null, `API key revoked: ${prefix}`);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  clearNewKeyValue: () => set({ newKeyValue: null }),

  // ─────────────────────────────────────────────
  // AUTOPILOT — periodic sweeps + healing
  // ─────────────────────────────────────────────

  startAutopilot: () => {
    const { sweepTimer, prefs } = get();
    if (sweepTimer) clearInterval(sweepTimer);

    // Run a sweep immediately, then on interval
    get().testAll();

    const timer = setInterval(() => {
      get().testAll();
    }, prefs.sweepIntervalMs);

    const newPrefs = { ...prefs, autopilotEnabled: true };
    savePrefs(newPrefs);

    set({ autopilot: true, sweepTimer: timer, prefs: newPrefs });
    get().addLog("autopilot", null, `Autopilot ON — sweeps every ${prefs.sweepIntervalMs / 1000}s`);
  },

  stopAutopilot: () => {
    const { sweepTimer, healTimer, prefs } = get();
    if (sweepTimer) clearInterval(sweepTimer);
    if (healTimer) clearTimeout(healTimer);

    const newPrefs = { ...prefs, autopilotEnabled: false };
    savePrefs(newPrefs);

    set({ autopilot: false, sweepTimer: null, healTimer: null, healQueue: [], prefs: newPrefs });
    get().addLog("autopilot", null, "Autopilot OFF");
  },

  updatePrefs: (updates) => {
    const newPrefs = { ...get().prefs, ...updates };
    savePrefs(newPrefs);
    set({ prefs: newPrefs });

    // If autopilot is running and interval changed, restart
    if (get().autopilot && updates.sweepIntervalMs) {
      get().stopAutopilot();
      get().startAutopilot();
    }
  },

  // ─────────────────────────────────────────────
  // SELF-HEALING — exponential backoff retries
  // ─────────────────────────────────────────────

  enqueueHeal: (slug) => {
    const { healQueue, prefs } = get();
    // Don't enqueue if already queued or if max retries exceeded
    const existing = healQueue.find((h) => h.slug === slug);
    if (existing) return;

    const patterns = get().patterns;
    const past = patterns.healAttempts[slug] || { attempts: 0, successes: 0 };
    if (past.attempts >= prefs.maxHealRetries * 3 && past.successes === 0) {
      // This connection never heals by itself — don't waste cycles
      get().addLog("heal", slug, "Skipped healing — never recovered automatically");
      return;
    }

    const entry = { slug, attempt: 0, nextAt: Date.now() + healBackoffMs(0) };
    set({ healQueue: [...healQueue, entry] });
    get().scheduleHealTick();
    get().addLog("heal", slug, "Queued for self-healing");
  },

  scheduleHealTick: () => {
    const { healTimer, healQueue } = get();
    if (healTimer) clearTimeout(healTimer);
    if (healQueue.length === 0) return;

    // Find the next item that's due
    const now = Date.now();
    const next = healQueue.reduce((earliest, h) =>
      h.nextAt < earliest.nextAt ? h : earliest,
    );

    const delay = Math.max(0, next.nextAt - now);
    const timer = setTimeout(() => get().processHealQueue(), delay);
    set({ healTimer: timer });
  },

  processHealQueue: async () => {
    const { healQueue, prefs } = get();
    if (healQueue.length === 0) return;

    const now = Date.now();
    const due = healQueue.find((h) => h.nextAt <= now);
    if (!due) {
      get().scheduleHealTick();
      return;
    }

    set({ healingSlug: due.slug });
    get().addLog("heal", due.slug, `Heal attempt ${due.attempt + 1}`);

    const result = await get().testOne(due.slug);

    if (result.status === "healthy" || result.status === "degraded") {
      // Healed! Remove from queue
      get().recordHealSuccess(due.slug);
      get().addLog("heal", due.slug, `Recovered! Status: ${result.status}`);
      set((s) => ({
        healQueue: s.healQueue.filter((h) => h.slug !== due.slug),
        healingSlug: null,
      }));
    } else {
      const nextAttempt = due.attempt + 1;
      if (nextAttempt >= prefs.maxHealRetries) {
        get().addLog("heal", due.slug, `Gave up after ${prefs.maxHealRetries} attempts`);
        set((s) => ({
          healQueue: s.healQueue.filter((h) => h.slug !== due.slug),
          healingSlug: null,
        }));
        get().recordHealFailure(due.slug);
      } else {
        set((s) => ({
          healQueue: s.healQueue.map((h) =>
            h.slug === due.slug
              ? { ...h, attempt: nextAttempt, nextAt: Date.now() + healBackoffMs(nextAttempt) }
              : h,
          ),
          healingSlug: null,
        }));
      }
    }

    get().scheduleHealTick();
  },

  // ─────────────────────────────────────────────
  // PATTERN LEARNING — persists to localStorage
  // ─────────────────────────────────────────────

  recordHealthResult: (slug, result) => {
    if (result.status === "down") {
      get().recordFailure(slug);
    }
  },

  recordFailure: (slug) => {
    const patterns = { ...get().patterns };
    patterns.failureCounts[slug] = (patterns.failureCounts[slug] || 0) + 1;
    patterns.failureTimes[slug] = [
      ...(patterns.failureTimes[slug] || []).slice(-49),
      Date.now(),
    ];
    patterns.lastUpdated = Date.now();
    savePatterns(patterns);
    set({ patterns });
  },

  recordCoFailures: (slugs) => {
    const patterns = { ...get().patterns };
    // Record pairwise co-failures
    for (let i = 0; i < slugs.length; i++) {
      for (let j = i + 1; j < slugs.length; j++) {
        const key = [slugs[i], slugs[j]].sort().join("|");
        patterns.coFailures[key] = (patterns.coFailures[key] || 0) + 1;
      }
    }
    patterns.lastUpdated = Date.now();
    savePatterns(patterns);
    set({ patterns });
  },

  recordHealSuccess: (slug) => {
    const patterns = { ...get().patterns };
    const entry = patterns.healAttempts[slug] || { attempts: 0, successes: 0 };
    entry.attempts += 1;
    entry.successes += 1;
    patterns.healAttempts[slug] = entry;
    patterns.lastUpdated = Date.now();
    savePatterns(patterns);
    set({ patterns });
  },

  recordHealFailure: (slug) => {
    const patterns = { ...get().patterns };
    const entry = patterns.healAttempts[slug] || { attempts: 0, successes: 0 };
    entry.attempts += 1;
    patterns.healAttempts[slug] = entry;
    patterns.lastUpdated = Date.now();
    savePatterns(patterns);
    set({ patterns });
  },

  clearPatterns: () => {
    const fresh = defaultPatterns();
    savePatterns(fresh);
    set({ patterns: fresh, insights: [] });
  },

  // ─────────────────────────────────────────────
  // INSIGHTS — derived from patterns + live data
  // ─────────────────────────────────────────────

  computeInsights: () => {
    const { connections, patterns } = get();
    const insights = [];

    // 1. Services that fail often
    for (const [slug, count] of Object.entries(patterns.failureCounts)) {
      if (count >= 5) {
        const conn = connections.find((c) => c.slug === slug);
        insights.push({
          type: "recurring_failure",
          severity: count >= 20 ? "high" : "medium",
          slug,
          name: conn?.name || slug,
          message: `Has failed ${count} times — consider investigating root cause`,
        });
      }
    }

    // 2. Co-failure patterns (services that go down together)
    for (const [pair, count] of Object.entries(patterns.coFailures)) {
      if (count >= 3) {
        const [a, b] = pair.split("|");
        const nameA = connections.find((c) => c.slug === a)?.name || a;
        const nameB = connections.find((c) => c.slug === b)?.name || b;
        insights.push({
          type: "co_failure",
          severity: "medium",
          slug: pair,
          message: `${nameA} and ${nameB} fail together (${count} times) — likely shared dependency`,
        });
      }
    }

    // 3. Services that never self-heal
    for (const [slug, record] of Object.entries(patterns.healAttempts)) {
      if (record.attempts >= 4 && record.successes === 0) {
        const conn = connections.find((c) => c.slug === slug);
        insights.push({
          type: "unhealable",
          severity: "high",
          slug,
          name: conn?.name || slug,
          message: `Never recovered via auto-heal (${record.attempts} attempts) — needs manual intervention`,
        });
      }
    }

    // 4. Currently degraded or down
    const down = connections.filter((c) => c.last_health_status === "down");
    const degraded = connections.filter((c) => c.last_health_status === "degraded");

    if (down.length > 0) {
      insights.unshift({
        type: "outage",
        severity: "critical",
        message: `${down.length} service${down.length > 1 ? "s" : ""} DOWN: ${down.map((c) => c.name).join(", ")}`,
      });
    }

    if (degraded.length > 0) {
      insights.unshift({
        type: "degradation",
        severity: "high",
        message: `${degraded.length} service${degraded.length > 1 ? "s" : ""} degraded: ${degraded.map((c) => c.name).join(", ")}`,
      });
    }

    // 5. Tier 0 check — trust anchors must be healthy
    const tier0Down = connections.filter(
      (c) => c.tier === 0 && c.last_health_status === "down",
    );
    if (tier0Down.length > 0) {
      insights.unshift({
        type: "critical_tier",
        severity: "critical",
        message: `Trust anchor DOWN: ${tier0Down.map((c) => c.name).join(", ")} — all dependent tiers affected`,
      });
    }

    set({ insights });
  },

  // ─────────────────────────────────────────────
  // ACTIVITY LOG — in-memory, most recent first
  // ─────────────────────────────────────────────

  addLog: (type, slug, message) => {
    set((s) => ({
      activityLog: [
        { time: Date.now(), type, slug, message },
        ...s.activityLog.slice(0, 99), // keep last 100
      ],
    }));
  },

  // ─────────────────────────────────────────────
  // COMPUTED — prioritized view of connections
  // ─────────────────────────────────────────────

  // Returns connections sorted by what needs attention
  getPrioritized: () => {
    const { connections } = get();
    const priority = { down: 0, degraded: 1, unknown: 2, healthy: 3 };
    return [...connections].sort((a, b) => {
      const pa = priority[a.last_health_status] ?? 2;
      const pb = priority[b.last_health_status] ?? 2;
      if (pa !== pb) return pa - pb;
      return (a.tier ?? 99) - (b.tier ?? 99);
    });
  },

  getNeedsAttention: () => {
    const { connections, healQueue } = get();
    return connections.filter(
      (c) =>
        c.last_health_status === "down" ||
        c.last_health_status === "degraded" ||
        healQueue.some((h) => h.slug === c.slug),
    );
  },

  getHealthy: () => {
    return get().connections.filter(
      (c) => c.last_health_status === "healthy",
    );
  },

  isHealing: (slug) => {
    return get().healQueue.some((h) => h.slug === slug);
  },

  // ─────────────────────────────────────────────
  // LIFECYCLE
  // ─────────────────────────────────────────────

  init: async () => {
    await get().fetchAll();
    await get().fetchApiKeys();
    // Resume autopilot if it was on
    if (get().prefs.autopilotEnabled) {
      get().startAutopilot();
    }
  },

  cleanup: () => {
    const { sweepTimer, healTimer } = get();
    if (sweepTimer) clearInterval(sweepTimer);
    if (healTimer) clearTimeout(healTimer);
  },
}));
