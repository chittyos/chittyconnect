import { useEffect, useState, useCallback } from "react";
import { useCommandStore } from "../stores/commandStore";
import { formatDistanceToNowStrict } from "date-fns";

const HEALTH_COLORS = {
  healthy: "var(--accent-success)",
  degraded: "var(--accent-warning)",
  down: "var(--accent-danger)",
  unknown: "var(--text-muted)",
};

const SEVERITY_COLORS = {
  critical: "var(--accent-danger)",
  high: "var(--accent-warning)",
  medium: "var(--accent-info)",
  low: "var(--text-secondary)",
};

const CATEGORY_ICONS = {
  chittyos_service: "S",
  thirdparty: "3P",
  database: "DB",
  ai_provider: "AI",
};

export default function Command() {
  const {
    loading,
    error,
    autopilot,
    sweepRunning,
    lastSweep,
    connectionStats,
    healQueue,
    healingSlug,
    insights,
    activityLog,
    prefs,
    newKeyValue,
    apiKeys,
    apiKeysLoading,
    init,
    cleanup,
    startAutopilot,
    stopAutopilot,
    updatePrefs,
    testOne,
    testAll,
    testCredential,
    enqueueHeal,
    createApiKey,
    revokeApiKey,
    clearNewKeyValue,
    clearPatterns,
    getPrioritized,
    getNeedsAttention,
    getHealthy,
    isHealing,
  } = useCommandStore();

  const [search, setSearch] = useState("");
  const [view, setView] = useState("connections"); // connections | keys | log
  const [testingSlug, setTestingSlug] = useState(null);
  const [showNewKey, setShowNewKey] = useState(false);
  const [keyForm, setKeyForm] = useState({ name: "", scopes: ["mcp:read", "mcp:write"], expiresAt: "" });
  const [showSettings, setShowSettings] = useState(false);
  const [expandHealthy, setExpandHealthy] = useState(false);

  useEffect(() => {
    init();
    return cleanup;
  }, []);

  const handleTest = useCallback(async (slug) => {
    setTestingSlug(slug);
    await testOne(slug);
    setTestingSlug(null);
  }, [testOne]);

  const handleHeal = useCallback((slug) => {
    enqueueHeal(slug);
  }, [enqueueHeal]);

  const handleSweep = useCallback(async () => {
    await testAll();
  }, [testAll]);

  const handleCreateKey = useCallback(async (e) => {
    e.preventDefault();
    const ok = await createApiKey(keyForm.name, keyForm.scopes, keyForm.expiresAt || null);
    if (ok) {
      setShowNewKey(false);
      setKeyForm({ name: "", scopes: ["mcp:read", "mcp:write"], expiresAt: "" });
    }
  }, [createApiKey, keyForm]);

  const prioritized = getPrioritized();
  const needsAttention = getNeedsAttention();
  const healthy = getHealthy();
  const stats = connectionStats || {};

  // Filter by search
  const filtered = search
    ? prioritized.filter(
        (c) =>
          c.name?.toLowerCase().includes(search.toLowerCase()) ||
          c.slug?.toLowerCase().includes(search.toLowerCase()) ||
          c.base_url?.toLowerCase().includes(search.toLowerCase()),
      )
    : prioritized;

  const attentionFiltered = search
    ? filtered.filter((c) => c.last_health_status !== "healthy")
    : needsAttention;

  const healthyFiltered = search
    ? filtered.filter((c) => c.last_health_status === "healthy")
    : healthy;

  return (
    <>
      {/* ─── HEADER ─── */}
      <header className="page-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 className="page-title">Command</h1>
          <p className="page-subtitle">Connections, credentials, and keys — autopilot aware</p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {/* Autopilot toggle */}
          <button
            className={`btn ${autopilot ? "btn-primary" : "btn-secondary"}`}
            style={{
              fontSize: "12px",
              padding: "6px 14px",
              ...(autopilot ? { animation: "none" } : {}),
            }}
            onClick={() => (autopilot ? stopAutopilot() : startAutopilot())}
          >
            <span
              style={{
                display: "inline-block",
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: autopilot ? "white" : "var(--text-muted)",
                marginRight: "6px",
                ...(autopilot
                  ? { boxShadow: "0 0 6px white", animation: "pulse 2s ease-in-out infinite" }
                  : {}),
              }}
            />
            {autopilot ? "Autopilot ON" : "Autopilot OFF"}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={handleSweep}
            disabled={sweepRunning}
          >
            {sweepRunning ? "Sweeping..." : "Sweep Now"}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
          >
            Settings
          </button>
        </div>
      </header>

      <div className="page-content">
        {/* ─── STATUS STRIP ─── */}
        <div
          className="stats-grid"
          style={{ gridTemplateColumns: "repeat(5, 1fr)", marginBottom: "16px" }}
        >
          <StatBlock label="Total" value={stats.total || prioritized.length} />
          <StatBlock label="Healthy" value={stats.healthy ?? healthy.length} color="var(--accent-success)" />
          <StatBlock label="Degraded" value={stats.degraded ?? 0} color="var(--accent-warning)" />
          <StatBlock
            label="Down"
            value={(stats.down ?? 0) + (stats.unknown ?? 0)}
            color="var(--accent-danger)"
          />
          <StatBlock
            label="Healing"
            value={healQueue.length}
            color={healQueue.length > 0 ? "var(--accent-info)" : "var(--text-muted)"}
            sub={healingSlug ? `Fixing: ${healingSlug}` : lastSweep ? `Last sweep ${formatDistanceToNowStrict(lastSweep)} ago` : null}
          />
        </div>

        {/* ─── SETTINGS PANEL ─── */}
        {showSettings && (
          <div className="card" style={{ marginBottom: "16px" }}>
            <div className="card-header">
              <span className="card-title">Autopilot Settings</span>
              <button className="btn btn-secondary btn-sm" onClick={() => setShowSettings(false)}>
                Close
              </button>
            </div>
            <div className="card-body" style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: "16px", alignItems: "end" }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Sweep Interval</label>
                <select
                  className="form-select"
                  value={prefs.sweepIntervalMs}
                  onChange={(e) => updatePrefs({ sweepIntervalMs: Number(e.target.value) })}
                >
                  <option value={30000}>30s</option>
                  <option value={60000}>1 min</option>
                  <option value={120000}>2 min</option>
                  <option value={300000}>5 min</option>
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Max Heal Retries</label>
                <select
                  className="form-select"
                  value={prefs.maxHealRetries}
                  onChange={(e) => updatePrefs({ maxHealRetries: Number(e.target.value) })}
                >
                  <option value={2}>2</option>
                  <option value={4}>4</option>
                  <option value={6}>6</option>
                  <option value={8}>8</option>
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Auto-Heal</label>
                <select
                  className="form-select"
                  value={prefs.autoHealEnabled ? "on" : "off"}
                  onChange={(e) => updatePrefs({ autoHealEnabled: e.target.value === "on" })}
                >
                  <option value="on">Enabled</option>
                  <option value="off">Disabled</option>
                </select>
              </div>
              <div className="form-group" style={{ margin: 0 }}>
                <label className="form-label">Credential Warn</label>
                <select
                  className="form-select"
                  value={prefs.credentialWarnDays}
                  onChange={(e) => updatePrefs({ credentialWarnDays: Number(e.target.value) })}
                >
                  <option value={3}>3 days</option>
                  <option value={7}>7 days</option>
                  <option value={14}>14 days</option>
                  <option value={30}>30 days</option>
                </select>
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  if (window.confirm("Clear all learned patterns? This resets healing history and failure tracking.")) {
                    clearPatterns();
                  }
                }}
                style={{ color: "var(--accent-danger)" }}
              >
                Reset Patterns
              </button>
            </div>
          </div>
        )}

        {/* ─── INSIGHTS ─── */}
        {insights.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "16px" }}>
            {insights.slice(0, 5).map((insight, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  background:
                    insight.severity === "critical"
                      ? "rgba(239, 68, 68, 0.08)"
                      : insight.severity === "high"
                        ? "rgba(245, 158, 11, 0.08)"
                        : "rgba(6, 182, 212, 0.08)",
                  border: `1px solid ${SEVERITY_COLORS[insight.severity]}22`,
                  fontSize: "13px",
                  color: "var(--text-primary)",
                }}
              >
                <span
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: SEVERITY_COLORS[insight.severity],
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1 }}>{insight.message}</span>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                    color: SEVERITY_COLORS[insight.severity],
                  }}
                >
                  {insight.severity}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* ─── VIEW TABS ─── */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px", alignItems: "center" }}>
          {["connections", "keys", "log"].map((v) => (
            <button
              key={v}
              className={`filter-chip ${view === v ? "active" : ""}`}
              onClick={() => setView(v)}
            >
              {v === "connections" ? "Connections" : v === "keys" ? "API Keys" : "Activity Log"}
              {v === "connections" && needsAttention.length > 0 && (
                <span
                  style={{
                    marginLeft: "6px",
                    background: "var(--accent-danger)",
                    color: "white",
                    fontSize: "10px",
                    fontWeight: 600,
                    padding: "1px 6px",
                    borderRadius: "8px",
                    lineHeight: "14px",
                  }}
                >
                  {needsAttention.length}
                </span>
              )}
            </button>
          ))}
          {view === "connections" && (
            <input
              type="text"
              placeholder="Filter..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                marginLeft: "auto",
                maxWidth: "240px",
                padding: "6px 12px",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                background: "var(--bg-secondary)",
                color: "var(--text-primary)",
                fontSize: "13px",
              }}
            />
          )}
          {view === "keys" && (
            <button
              className="btn btn-primary btn-sm"
              style={{ marginLeft: "auto" }}
              onClick={() => setShowNewKey(true)}
            >
              New Key
            </button>
          )}
        </div>

        {/* ─── CONNECTIONS VIEW ─── */}
        {view === "connections" && (
          <>
            {loading && prioritized.length === 0 ? (
              <div className="loading-container"><div className="loading-spinner" /></div>
            ) : error && prioritized.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-title">Failed to load</div>
                <div className="empty-state-message">{error}</div>
              </div>
            ) : (
              <>
                {/* Needs attention */}
                {attentionFiltered.length > 0 && (
                  <>
                    <div style={{ fontSize: "11px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--accent-danger)", marginBottom: "8px" }}>
                      Needs Attention ({attentionFiltered.length})
                    </div>
                    <div className="entity-grid" style={{ marginBottom: "24px" }}>
                      {attentionFiltered.map((conn) => (
                        <ConnectionCard
                          key={conn.id}
                          conn={conn}
                          testing={testingSlug === conn.slug}
                          healing={isHealing(conn.slug)}
                          isHealTarget={healingSlug === conn.slug}
                          onTest={() => handleTest(conn.slug)}
                          onHeal={() => handleHeal(conn.slug)}
                          onTestCred={() => testCredential(conn.slug)}
                        />
                      ))}
                    </div>
                  </>
                )}

                {/* Healthy */}
                {healthyFiltered.length > 0 && (
                  <>
                    <div
                      style={{
                        fontSize: "11px",
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        color: "var(--accent-success)",
                        marginBottom: "8px",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        cursor: "pointer",
                        userSelect: "none",
                      }}
                      onClick={() => setExpandHealthy(!expandHealthy)}
                    >
                      <span style={{ transition: "transform 0.2s", transform: expandHealthy ? "rotate(90deg)" : "rotate(0)" }}>
                        &#9654;
                      </span>
                      Healthy ({healthyFiltered.length})
                    </div>
                    {expandHealthy && (
                      <div className="entity-grid">
                        {healthyFiltered.map((conn) => (
                          <ConnectionCard
                            key={conn.id}
                            conn={conn}
                            testing={testingSlug === conn.slug}
                            healing={false}
                            isHealTarget={false}
                            onTest={() => handleTest(conn.slug)}
                            onHeal={null}
                            onTestCred={() => testCredential(conn.slug)}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}

                {filtered.length === 0 && (
                  <div className="empty-state">
                    <div className="empty-state-title">No connections match</div>
                    <div className="empty-state-message">Try a different search term</div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {/* ─── API KEYS VIEW ─── */}
        {view === "keys" && (
          <>
            {newKeyValue && (
              <div className="key-created-alert" style={{ marginBottom: "16px" }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Key Created — copy now</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <code
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      background: "var(--bg-tertiary)",
                      borderRadius: 6,
                      fontSize: 12,
                      wordBreak: "break-all",
                      fontFamily: "'SF Mono', Consolas, monospace",
                    }}
                  >
                    {newKeyValue}
                  </code>
                  <button
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      navigator.clipboard.writeText(newKeyValue);
                    }}
                  >
                    Copy
                  </button>
                  <button className="btn btn-sm" style={{ color: "var(--text-muted)" }} onClick={clearNewKeyValue}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {apiKeysLoading ? (
              <div className="loading-container"><div className="loading-spinner" /></div>
            ) : apiKeys.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-title">No API Keys</div>
                <div className="empty-state-message">Create one to authenticate with ChittyConnect.</div>
              </div>
            ) : (
              <div className="card">
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Key</th>
                        <th>Scopes</th>
                        <th>Status</th>
                        <th>Expires</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {apiKeys.map((k) => (
                        <tr key={k.key}>
                          <td style={{ fontWeight: 500 }}>{k.name}</td>
                          <td style={{ fontFamily: "'SF Mono', Consolas, monospace", fontSize: 12 }}>
                            {k.key}
                          </td>
                          <td>
                            {(k.scopes || []).map((s) => (
                              <span key={s} className="scope-badge" style={{ marginRight: 4 }}>{s}</span>
                            ))}
                          </td>
                          <td>
                            <span className={`status-badge ${k.status}`}>{k.status}</span>
                          </td>
                          <td style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                            {k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : "Never"}
                          </td>
                          <td>
                            {k.status === "active" && (
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => revokeApiKey(k.prefix || k.key.split("...")[0])}
                              >
                                Revoke
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* ─── ACTIVITY LOG VIEW ─── */}
        {view === "log" && (
          <div className="card">
            <div className="card-body" style={{ padding: 0 }}>
              {activityLog.length === 0 ? (
                <div className="empty-state" style={{ padding: "40px" }}>
                  <div className="empty-state-title">No activity yet</div>
                  <div className="empty-state-message">
                    Run a sweep or enable autopilot to start logging.
                  </div>
                </div>
              ) : (
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: "100px" }}>Time</th>
                        <th style={{ width: "80px" }}>Type</th>
                        <th style={{ width: "140px" }}>Service</th>
                        <th>Event</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activityLog.map((entry, i) => (
                        <tr key={i}>
                          <td style={{ fontSize: 12, fontFamily: "'SF Mono', Consolas, monospace", color: "var(--text-muted)" }}>
                            {new Date(entry.time).toLocaleTimeString()}
                          </td>
                          <td>
                            <LogTypeBadge type={entry.type} />
                          </td>
                          <td style={{ fontSize: 13, fontFamily: "'SF Mono', Consolas, monospace" }}>
                            {entry.slug || "—"}
                          </td>
                          <td style={{ fontSize: 13 }}>{entry.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── NEW KEY MODAL ─── */}
      {showNewKey && (
        <div className="modal-overlay" onClick={() => setShowNewKey(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Create API Key</span>
              <button className="modal-close" onClick={() => setShowNewKey(false)}>&times;</button>
            </div>
            <form onSubmit={handleCreateKey}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Name</label>
                  <input
                    className="form-input"
                    placeholder="e.g. Claude Desktop"
                    value={keyForm.name}
                    onChange={(e) => setKeyForm({ ...keyForm, name: e.target.value })}
                    required
                    autoFocus
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Scopes</label>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {["mcp:read", "mcp:write"].map((s) => (
                      <label
                        key={s}
                        className={`filter-chip ${keyForm.scopes.includes(s) ? "active" : ""}`}
                        style={{ cursor: "pointer" }}
                      >
                        <input
                          type="checkbox"
                          checked={keyForm.scopes.includes(s)}
                          onChange={() =>
                            setKeyForm({
                              ...keyForm,
                              scopes: keyForm.scopes.includes(s)
                                ? keyForm.scopes.filter((x) => x !== s)
                                : [...keyForm.scopes, s],
                            })
                          }
                          style={{ display: "none" }}
                        />
                        {s}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">Expires (optional)</label>
                  <input
                    type="date"
                    className="form-input"
                    value={keyForm.expiresAt}
                    onChange={(e) => setKeyForm({ ...keyForm, expiresAt: e.target.value })}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowNewKey(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={!keyForm.name.trim()}>
                  Create Key
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </>
  );
}

// ─── Connection Card ───
function ConnectionCard({ conn, testing, healing, isHealTarget, onTest, onHeal, onTestCred }) {
  const healthColor = HEALTH_COLORS[conn.last_health_status] || HEALTH_COLORS.unknown;
  const isDown = conn.last_health_status === "down";
  const isDegraded = conn.last_health_status === "degraded";

  return (
    <div
      className="connection-card"
      style={{
        borderColor: isDown ? "var(--accent-danger)" : isDegraded ? "var(--accent-warning)" : undefined,
        borderLeftWidth: isDown || isDegraded ? "3px" : undefined,
      }}
    >
      <div className="connection-card-header">
        <div
          className="connection-icon"
          style={{
            background: isDown
              ? "linear-gradient(135deg, var(--accent-danger), #b91c1c)"
              : isDegraded
                ? "linear-gradient(135deg, var(--accent-warning), #d97706)"
                : `linear-gradient(135deg, ${tierColor(conn.tier, conn.category)}, ${tierColor(conn.tier, conn.category)}88)`,
          }}
        >
          {CATEGORY_ICONS[conn.category] || conn.name?.charAt(0)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="connection-name">{conn.name}</div>
          <div className="connection-url">{conn.base_url || "No URL"}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {healing && (
            <span
              style={{
                fontSize: "10px",
                fontWeight: 600,
                color: "var(--accent-info)",
                textTransform: "uppercase",
                letterSpacing: "0.3px",
                ...(isHealTarget ? { animation: "pulse 1s ease-in-out infinite" } : {}),
              }}
            >
              {isHealTarget ? "Healing..." : "Queued"}
            </span>
          )}
          <div
            className="connection-status-dot"
            style={{
              background: healthColor,
              boxShadow: isDown ? `0 0 8px ${healthColor}` : undefined,
            }}
            title={conn.last_health_status || "unknown"}
          />
        </div>
      </div>

      {conn.description && (
        <div className="connection-description" style={{ marginBottom: "10px" }}>
          {conn.description}
        </div>
      )}

      <div className="connection-card-footer">
        {conn.tier != null && (
          <span
            className="category-badge"
            style={{
              borderColor: tierColor(conn.tier, conn.category),
              color: tierColor(conn.tier, conn.category),
              fontSize: "10px",
            }}
          >
            {conn.category === "chittyos_service" ? `Tier ${conn.tier}` : conn.category?.replace("_", " ")}
          </span>
        )}

        {conn.credential_source && conn.credential_source !== "none" && (
          <span
            style={{
              fontSize: "10px",
              color: "var(--text-muted)",
              fontFamily: "'SF Mono', Consolas, monospace",
            }}
          >
            {conn.credential_source}
          </span>
        )}

        {conn.last_health_latency_ms != null && (
          <span className="connection-latency">{conn.last_health_latency_ms}ms</span>
        )}

        {conn.last_health_check && (
          <span
            style={{ fontSize: "10px", color: "var(--text-muted)", marginLeft: "auto", marginRight: "4px" }}
          >
            {formatDistanceToNowStrict(new Date(conn.last_health_check))} ago
          </span>
        )}

        <div style={{ display: "flex", gap: "4px", marginLeft: conn.last_health_check ? "0" : "auto" }}>
          {isDown && onHeal && !healing && (
            <button
              className="btn btn-sm"
              style={{
                background: "rgba(6, 182, 212, 0.15)",
                color: "var(--accent-info)",
                border: "1px solid rgba(6, 182, 212, 0.3)",
                padding: "3px 10px",
                fontSize: "11px",
              }}
              onClick={(e) => { e.stopPropagation(); onHeal(); }}
            >
              Heal
            </button>
          )}
          <button
            className="btn btn-secondary btn-sm connection-test-btn"
            onClick={(e) => { e.stopPropagation(); onTest(); }}
            disabled={testing}
            style={{ padding: "3px 10px", fontSize: "11px" }}
          >
            {testing ? "..." : "Test"}
          </button>
        </div>
      </div>
    </div>
  );
}

function tierColor(tier, category) {
  if (category === "thirdparty") return "#06b6d4";
  if (category === "database") return "#f59e0b";
  if (category === "ai_provider") return "#ec4899";
  const colors = {
    0: "#22c55e",
    1: "#6366f1",
    2: "#8b5cf6",
    3: "#06b6d4",
    4: "#f59e0b",
    5: "#ec4899",
  };
  return colors[tier] ?? "#6366f1";
}

function StatBlock({ label, value, color, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: color || "var(--text-primary)" }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: "10px", color: "var(--text-muted)", marginTop: "6px", fontFamily: "'SF Mono', Consolas, monospace" }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function LogTypeBadge({ type }) {
  const styles = {
    test: { bg: "rgba(99, 102, 241, 0.15)", color: "var(--accent-primary)" },
    sweep: { bg: "rgba(99, 102, 241, 0.15)", color: "var(--accent-primary)" },
    heal: { bg: "rgba(6, 182, 212, 0.15)", color: "var(--accent-info)" },
    credential: { bg: "rgba(34, 197, 94, 0.15)", color: "var(--accent-success)" },
    key: { bg: "rgba(139, 92, 246, 0.15)", color: "var(--accent-secondary)" },
    autopilot: { bg: "rgba(245, 158, 11, 0.15)", color: "var(--accent-warning)" },
    error: { bg: "rgba(239, 68, 68, 0.15)", color: "var(--accent-danger)" },
  };
  const s = styles[type] || styles.test;
  return (
    <span
      className="status-badge"
      style={{
        background: s.bg,
        color: s.color,
        fontSize: "10px",
        fontWeight: 600,
      }}
    >
      {type}
    </span>
  );
}
