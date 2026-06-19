import { Actor, handler } from "@cloudflare/actors";

/* global WebSocketPair */

/**
 * MyChittyActor - The "Synthetic Person" Stateful Actor
 *
 * Built on @cloudflare/actors to replace the raw SessionStateDO.
 * This Actor securely houses the identity, context, ledger decisions,
 * and the master credentials for a single ChittyID.
 *
 * Features:
 * - RPC Interface (No more manual HTTP routing)
 * - Managed Lifecycles (onInit, onAlarm)
 * - WebSocket native support
 */
export class MyChittyActor extends Actor {
  // We can initialize state in onInit, which is guaranteed to run on cold starts
  async onInit() {
    console.log(
      `[MyChittyActor] Waking up ChittyID: ${this.ctx.id.toString()}`,
    );

    // Load from storage or set defaults
    this.sessions = (await this.ctx.storage.get("sessions")) || {};
    this.decisions = (await this.ctx.storage.get("decisions")) || [];
    this.context = (await this.ctx.storage.get("context")) || {};
    this.masterKeys = (await this.ctx.storage.get("masterKeys")) || {};

    this.websockets = new Set();

    // Set cleanup alarm if none exists
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (!currentAlarm) {
      await this.ctx.storage.setAlarm(Date.now() + 3600000); // 1 hour
    }
  }

  // --- RPC Interface (Replaces the HTTP Switch/Case) ---

  /**
   * Called by the Gateway to retrieve the injected master credentials
   * ONLY AFTER the action has been successfully recorded to the Ledger.
   */
  async getInjectedCredentials(ledgerProof) {
    // Validate the proof structure
    if (!ledgerProof || typeof ledgerProof !== "object") {
      throw new Error("UNAUTHORIZED: No ledger proof provided");
    }
    if (!ledgerProof.verified) {
      throw new Error("UNAUTHORIZED: Action not committed to Ledger");
    }
    if (!ledgerProof.proof_id) {
      throw new Error("UNAUTHORIZED: Ledger proof missing proof_id");
    }

    // Log the credential access to the decision trail
    const accessRecord = {
      type: "credential_access",
      proof_id: ledgerProof.proof_id,
      hash: ledgerProof.hash || "unknown",
      domain: ledgerProof.credential_domain || "all",
      timestamp: Date.now(),
    };
    this.decisions.push(accessRecord);
    if (this.decisions.length > 100) {
      this.decisions = this.decisions.slice(-100);
    }
    await this.persist();
    this.broadcastUpdate("credential_accessed", accessRecord);

    return this.masterKeys;
  }

  /**
   * Update the global master credentials for this ChittyID (Portal Use Only)
   */
  async updateMasterCredentials(keys) {
    this.masterKeys = { ...this.masterKeys, ...keys };
    await this.persist();
    this.broadcastUpdate("credentials_updated", {
      domains: Object.keys(keys),
    });
    return { success: true, domains: Object.keys(this.masterKeys) };
  }

  /**
   * Remove credentials for a specific domain (Portal Use Only)
   */
  async removeMasterCredentials(domain) {
    delete this.masterKeys[domain];
    await this.persist();
    this.broadcastUpdate("credentials_removed", { domain });
    return { success: true, remaining: Object.keys(this.masterKeys) };
  }

  /**
   * List which credential domains are provisioned (no secret values)
   */
  async getProvisionedDomains() {
    return Object.keys(this.masterKeys).map((domain) => ({
      domain,
      has_token: !!(
        this.masterKeys[domain]?.token ||
        this.masterKeys[domain]?.api_key ||
        this.masterKeys[domain]?.bearer
      ),
      has_api_token: !!this.masterKeys[domain]?.api_token,
      has_account_id: !!this.masterKeys[domain]?.account_id,
    }));
  }

  /**
   * Get the Resume/Context for the ChittyID (for the Portal)
   */
  async getResume() {
    return {
      chittyId: this.ctx.id.toString(),
      activeSessions: Object.keys(this.sessions).length,
      context: this.context,
      recentDecisions: this.decisions.slice(-10),
      metrics: this.estimateMemoryUsage(),
    };
  }

  /**
   * Create a new viewport session
   */
  async createSession(sessionId, metadata) {
    const session = {
      id: sessionId,
      created: Date.now(),
      updated: Date.now(),
      expires: Date.now() + 24 * 60 * 60 * 1000,
      metadata,
      state: "active",
      interactions: 0,
    };

    this.sessions[sessionId] = session;
    await this.persist();
    this.broadcastUpdate("session_created", session);

    return session;
  }

  /**
   * Record a decision to the Ledger history
   */
  async addDecision(decisionData) {
    const decision = {
      ...decisionData,
      timestamp: Date.now(),
    };
    this.decisions.push(decision);

    // Keep last 100
    if (this.decisions.length > 100) {
      this.decisions = this.decisions.slice(-100);
    }

    await this.persist();
    this.broadcastUpdate("decision_added", decision);

    return decision;
  }

  /**
   * Manage Context (MemoryCloude)
   */
  async setContext(key, value) {
    this.context[key] = value;
    this.context.updated = Date.now();
    await this.persist();
    this.broadcastUpdate("context_updated", { key, value });
    return { success: true };
  }

  async getContext(key) {
    return key ? this.context[key] : this.context;
  }

  // --- Internals ---

  async persist() {
    await this.ctx.storage.put({
      sessions: this.sessions,
      decisions: this.decisions,
      context: this.context,
      masterKeys: this.masterKeys,
      lastPersisted: Date.now(),
    });
  }

  // Built-in Actor lifecycle method for Alarms
  async onAlarm() {
    console.log("[MyChittyActor] Running scheduled cleanup");
    const now = Date.now();
    let cleaned = 0;

    // Clean expired sessions
    for (const [sessionId, session] of Object.entries(this.sessions)) {
      if (session.expires < now) {
        delete this.sessions[sessionId];
        cleaned++;
      }
    }

    // Clean old decisions (> 7 days)
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const initialDecisionsCount = this.decisions.length;
    this.decisions = this.decisions.filter((d) => d.timestamp > weekAgo);

    if (cleaned > 0 || this.decisions.length !== initialDecisionsCount) {
      await this.persist();
    }

    // Reschedule
    await this.ctx.storage.setAlarm(Date.now() + 3600000);
  }

  // --- WebSocket Implementation (Optional fallback if not using RPC) ---

  async onRequest(request) {
    // We can still support the legacy HTTP/WebSocket path
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.ctx.acceptWebSocket(server);
      this.websockets.add(server);

      server.addEventListener("message", async (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "ping")
          server.send(JSON.stringify({ type: "pong" }));
      });

      server.addEventListener("close", () => this.websockets.delete(server));

      server.send(
        JSON.stringify({
          type: "connected",
          sessions: Object.values(this.sessions),
          context: this.context,
        }),
      );

      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Use RPC or WebSocket to connect to this Actor", {
      status: 400,
    });
  }

  broadcastUpdate(type, data) {
    const message = JSON.stringify({ type, data, timestamp: Date.now() });
    for (const ws of this.websockets) {
      try {
        ws.send(message);
      } catch {
        this.websockets.delete(ws);
      }
    }
  }

  estimateMemoryUsage() {
    return {
      sessions: `${(JSON.stringify(this.sessions).length / 1024).toFixed(2)} KB`,
      decisions: `${(JSON.stringify(this.decisions).length / 1024).toFixed(2)} KB`,
      context: `${(JSON.stringify(this.context).length / 1024).toFixed(2)} KB`,
    };
  }
}

// Export the class wrapped in the actor handler
export default handler(MyChittyActor);
