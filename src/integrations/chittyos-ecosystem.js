/**
 * ChittyOS Ecosystem Integration Module
 *
 * Provides seamless integration with ChittyOS services:
 * - ChittyRegistry: Service discovery and routing
 * - ChittyID: Identity authority and minting
 * - ChittyAuth: API key management and authentication
 * - ChittyVerify: Context verification
 * - ChittyCertify: Service certification
 * - ChittyDNA: Context initialization and tracking
 * - ChittyCanon: Canonical definitions and validation
 */

// Import for future use
// import { chittyCanon } from "./chittycanon-client.js";

/**
 * ChittyOS Ecosystem Manager
 * Central orchestration for all ChittyOS service interactions
 */
export class ChittyOSEcosystem {
  constructor(env) {
    this.env = env;
    this.baseUrls = {
      registry: env.REGISTRY_SERVICE_URL || "https://registry.chitty.cc",
      chittyid: env.CHITTYID_SERVICE_URL || "https://id.chitty.cc",
      auth: "https://auth.chitty.cc",
      verify: "https://verify.chitty.cc",
      certify: "https://certify.chitty.cc",
      dna: "https://dna.chitty.cc",
    };

    // Service cache
    this.serviceCache = null;
    this.cacheExpiry = null;
    this.cacheTTL = 300000; // 5 minutes
  }

  /**
   * Initialize ChittyConnect context
   * - Registers with ChittyRegistry
   * - Mints ChittyID if needed
   * - Initializes ChittyDNA record
   * - Obtains API keys from ChittyAuth
   * - Verifies and certifies context
   */
  async initializeContext(contextName, metadata = {}) {
    console.log(`[ChittyOS] Initializing context: ${contextName}`);

    // 1. Check if context already has ChittyID and DNA record
    const existingContext = await this.getContextByName(contextName);

    if (existingContext && existingContext.chittyid && existingContext.dna) {
      console.log(`[ChittyOS] Context exists: ${existingContext.chittyid}`);
      return existingContext;
    }

    // 2. NEW CONTEXT: Initialize full ChittyOS lifecycle
    console.log(`[ChittyOS] New context detected, initializing...`);

    // 2a. Mint ChittyID for the context
    // @canon: chittycanon://gov/governance#core-types
    // Integration contexts are Person (P, Synthetic) — actors with agency
    const chittyid = await this.mintChittyID({
      entity: "P",
      characterization: "Synthetic",
      metadata: {
        name: contextName,
        type: "chittyconnect_integration",
        ...metadata,
      },
    });

    // 2b. Initialize ChittyDNA record
    const dna = await this.initializeChittyDNA(chittyid, {
      contextName,
      metadata,
      initializedAt: new Date().toISOString(),
      service: "chittyconnect",
    });

    // 2c. Request API keys from ChittyAuth
    const apiKeys = await this.requestAPIKeys(chittyid, {
      service: "chittyconnect",
      context: contextName,
      scopes: ["read", "write", "admin"],
    });

    // 2d. Register with ChittyRegistry (opt-in via env flag)
    if (this.env?.REGISTRY_AUTO_REGISTER === "true") {
      await this.registerService({
        chittyid,
        name: contextName,
        type: "integration",
        capabilities: ["mcp", "rest-api", "github-app"],
        health: `https://connect.chitty.cc/health`,
      });
    } else {
      console.log(
        "[ChittyRegistry] Auto-register skipped (set REGISTRY_AUTO_REGISTER=true to enable)",
      );
    }

    // 2e. Verify context with ChittyVerify
    const verification = await this.verifyContext(chittyid, {
      chittyid,
      dna: dna.id,
      apiKeys: apiKeys.keyId,
    });

    // 2f. Certify context with ChittyCertify
    const certification = await this.certifyContext(chittyid, {
      verification: verification.id,
      compliantWith: ["chittyos-v1", "mcp-2024-11-05"],
      securityLevel: "standard",
    });

    // 3. Store context in D1
    await this.storeContext({
      chittyid,
      name: contextName,
      dna: dna.id,
      apiKeys: apiKeys.keyId,
      verification: verification.id,
      certification: certification.id,
      metadata,
    });

    console.log(`[ChittyOS] Context initialized successfully: ${chittyid}`);

    return {
      chittyid,
      dna,
      apiKeys,
      verification,
      certification,
    };
  }

  /**
   * Discover available services from ChittyRegistry
   * Caches results for performance
   */
  async discoverServices(forceRefresh = false) {
    const now = Date.now();

    // Return cached services if still valid
    if (!forceRefresh && this.serviceCache && this.cacheExpiry > now) {
      return this.serviceCache;
    }

    try {
      const response = await fetch(`${this.baseUrls.registry}/api/services`, {
        headers: {
          Authorization: `Bearer ${this.env.CHITTY_REGISTRY_TOKEN}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Registry discovery failed: ${response.status}`);
      }

      const services = await response.json();

      // Update cache
      this.serviceCache = services;
      this.cacheExpiry = now + this.cacheTTL;

      return services;
    } catch (error) {
      console.error(`[ChittyOS] Service discovery failed:`, error);
      // Return cached data even if expired, better than nothing
      return this.serviceCache || { services: [] };
    }
  }

  /**
   * Mint ChittyID through central authority
   * NO local generation - always calls id.chitty.cc
   */
  async mintChittyID(args) {
    console.log(`[ChittyID] Minting new ${args.entity} ChittyID...`);

    try {
      const response = await fetch(`${this.baseUrls.chittyid}/v1/mint`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.env.CHITTY_ID_TOKEN}`,
        },
        body: JSON.stringify(args),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `ChittyID minting failed: ${response.status} - ${error}`,
        );
      }

      const result = await response.json();
      console.log(`[ChittyID] Minted: ${result.id}`);
      return result.id;
    } catch (error) {
      console.error(`[ChittyID] Minting error:`, error);
      throw error;
    }
  }

  /**
   * Initialize ChittyDNA record for new context
   * ChittyDNA provides genetic tracking of context evolution
   */
  async initializeChittyDNA(chittyid, metadata) {
    console.log(`[ChittyDNA] Initializing DNA record for ${chittyid}...`);

    try {
      const response = await fetch(`${this.baseUrls.dna}/api/initialize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.env.CHITTY_DNA_TOKEN}`,
          "X-ChittyID": chittyid,
        },
        body: JSON.stringify({
          chittyid,
          type: "context",
          metadata,
          genesis: {
            service: "chittyconnect",
            timestamp: new Date().toISOString(),
            version: "1.0.0",
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `ChittyDNA initialization failed: ${response.status} - ${error}`,
        );
      }

      const dna = await response.json();
      console.log(`[ChittyDNA] Initialized: ${dna.id}`);
      return dna;
    } catch (error) {
      console.error(`[ChittyDNA] Initialization error:`, error);
      // DNA is not critical for operation, log and continue
      return { id: null, error: error.message };
    }
  }

  /**
   * Request API keys from ChittyAuth
   * Seamless key provisioning for new contexts
   */
  async requestAPIKeys(chittyid, keyParams) {
    console.log(`[ChittyAuth] Requesting API keys for ${chittyid}...`);

    try {
      const response = await fetch(`${this.baseUrls.auth}/api/keys/provision`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.env.CHITTY_AUTH_TOKEN}`,
          "X-ChittyID": chittyid,
        },
        body: JSON.stringify(keyParams),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `API key provisioning failed: ${response.status} - ${error}`,
        );
      }

      const keys = await response.json();

      // Store keys securely in KV
      await this.env.API_KEYS.put(
        `chittyid:${chittyid}`,
        JSON.stringify(keys),
        { expirationTtl: 86400 * 365 }, // 1 year
      );

      console.log(`[ChittyAuth] API keys provisioned: ${keys.keyId}`);
      return keys;
    } catch (error) {
      console.error(`[ChittyAuth] Key provisioning error:`, error);
      throw error;
    }
  }

  /**
   * Register service with ChittyRegistry
   */
  async registerService(serviceConfig) {
    console.log(
      `[ChittyRegistry] Registering service: ${serviceConfig.name}...`,
    );

    try {
      const response = await fetch(
        `${this.baseUrls.registry}/api/services/register`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.env.CHITTY_REGISTRY_TOKEN}`,
          },
          body: JSON.stringify(serviceConfig),
        },
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `Service registration failed: ${response.status} - ${error}`,
        );
      }

      const result = await response.json();
      console.log(`[ChittyRegistry] Service registered successfully`);
      return result;
    } catch (error) {
      console.error(`[ChittyRegistry] Registration error:`, error);
      // Registration failure is not critical
      return { registered: false, error: error.message };
    }
  }

  /**
   * Verify context with ChittyVerify
   * Ensures context meets ChittyOS compliance standards
   */
  async verifyContext(chittyid, verificationData) {
    console.log(`[ChittyVerify] Verifying context ${chittyid}...`);

    try {
      const response = await fetch(
        `${this.baseUrls.verify}/api/verify/context`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.env.CHITTY_VERIFY_TOKEN}`,
            "X-ChittyID": chittyid,
          },
          body: JSON.stringify(verificationData),
        },
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `Context verification failed: ${response.status} - ${error}`,
        );
      }

      const verification = await response.json();
      console.log(
        `[ChittyVerify] Verification complete: ${verification.status}`,
      );
      return verification;
    } catch (error) {
      console.error(`[ChittyVerify] Verification error:`, error);
      return { verified: false, error: error.message };
    }
  }

  /**
   * Certify context with ChittyCertify
   * Issues official certification for ChittyOS compliance
   */
  async certifyContext(chittyid, certificationData) {
    console.log(`[ChittyCertify] Certifying context ${chittyid}...`);

    try {
      const response = await fetch(
        `${this.baseUrls.certify}/api/certify/context`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.env.CHITTY_CERTIFY_TOKEN}`,
            "X-ChittyID": chittyid,
          },
          body: JSON.stringify(certificationData),
        },
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(
          `Context certification failed: ${response.status} - ${error}`,
        );
      }

      const certification = await response.json();
      console.log(`[ChittyCertify] Certification issued: ${certification.id}`);
      return certification;
    } catch (error) {
      console.error(`[ChittyCertify] Certification error:`, error);
      return { certified: false, error: error.message };
    }
  }

  /**
   * Get context by name from D1 database
   */
  async getContextByName(contextName) {
    try {
      const result = await this.env.DB.prepare(
        "SELECT * FROM contexts WHERE name = ?",
      )
        .bind(contextName)
        .first();

      return result;
    } catch (error) {
      console.error(`[DB] Context lookup error:`, error);
      return null;
    }
  }

  /**
   * Store context in D1 database
   */
  async storeContext(context) {
    try {
      await this.env.DB.prepare(
        `INSERT OR REPLACE INTO contexts
         (chittyid, name, dna_id, api_key_id, verification_id, certification_id, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      )
        .bind(
          context.chittyid,
          context.name,
          context.dna,
          context.apiKeys,
          context.verification,
          context.certification,
          JSON.stringify(context.metadata),
        )
        .run();

      console.log(`[DB] Context stored: ${context.name}`);
    } catch (error) {
      console.error(`[DB] Context storage error:`, error);
      throw error;
    }
  }

  /**
   * Route request to appropriate service based on registry
   */
  async routeToService(serviceName, path, options = {}) {
    const services = await this.discoverServices();
    const service = services.services?.find((s) => s.name === serviceName);

    if (!service) {
      throw new Error(`Service not found in registry: ${serviceName}`);
    }

    const url = `${service.baseUrl}${path}`;
    console.log(`[Router] Routing to ${serviceName}: ${url}`);

    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        "X-ChittyConnect-Origin": "chittyconnect",
        "X-ChittyOS-Version": "1.0.0",
      },
    });
  }
}

/**
 * Initialize D1 database schema for contexts and GitHub installations
 */
export async function initializeDatabase(db) {
  // Contexts table
  await db
    .prepare(
      `
    CREATE TABLE IF NOT EXISTS contexts (
      chittyid TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      dna_id TEXT,
      api_key_id TEXT,
      verification_id TEXT,
      certification_id TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
    )
    .run();

  await db
    .prepare(
      `
    CREATE INDEX IF NOT EXISTS idx_contexts_name ON contexts(name)
  `,
    )
    .run();

  // GitHub installations table
  await db
    .prepare(
      `
    CREATE TABLE IF NOT EXISTS installations (
      installation_id INTEGER PRIMARY KEY,
      chittyid TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      account_login TEXT NOT NULL,
      account_type TEXT NOT NULL,
      repository_selection TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chittyid) REFERENCES contexts(chittyid)
    )
  `,
    )
    .run();

  await db
    .prepare(
      `
    CREATE INDEX IF NOT EXISTS idx_installations_chittyid ON installations(chittyid)
  `,
    )
    .run();

  await db
    .prepare(
      `
    CREATE INDEX IF NOT EXISTS idx_installations_account ON installations(account_id)
  `,
    )
    .run();

  console.log("[DB] Database schema initialized");
}
