/**
 * ChittyID Client Library
 *
 * Official client for minting and validating ChittyIDs from id.chitty.cc
 *
 * @example
 * import { ChittyIDClient } from '@chittyos/chittyid-client';
 *
 * const client = new ChittyIDClient({ token: 'your-service-token' });
 * const result = await client.mint('person', { jurisdiction: 'USA' });
 * console.log(result.chittyId); // 03-1-USA-1234-P-2601-3-42
 */

const DEFAULT_SERVICE_URL = "https://id.chitty.cc";

/**
 * Entity types for ChittyID minting
 */
export const EntityType = {
  PERSON: "person",
  PLACE: "place",
  THING: "thing",
  EVENT: "event",
  AUTHORITY: "authority",
};

/**
 * Geographic regions (G field)
 */
export const Region = {
  NORTH_AMERICA: "1",
  SOUTH_AMERICA: "2",
  EUROPE: "3",
  AFRICA: "4",
  ASIA: "5",
  OCEANIA: "6",
  MIDDLE_EAST: "7",
  CENTRAL_AMERICA: "8",
  GLOBAL: "9",
};

/**
 * Trust levels (C field)
 */
export const TrustLevel = {
  ANONYMOUS: 0,
  BASIC: 1,
  ENHANCED: 2,
  PROFESSIONAL: 3,
  INSTITUTIONAL: 4,
  OFFICIAL: 5,
};

/**
 * ChittyID Client
 */
export class ChittyIDClient {
  /**
   * Create a new ChittyID client
   *
   * @param {Object} options - Client options
   * @param {string} [options.serviceUrl] - ChittyID service URL (default: https://id.chitty.cc)
   * @param {string} [options.token] - Service token for authenticated requests
   * @param {string} [options.apiKey] - API key (alternative to token)
   */
  constructor(options = {}) {
    this.serviceUrl =
      options.serviceUrl ||
      process.env.CHITTYID_SERVICE_URL ||
      DEFAULT_SERVICE_URL;
    this.token = options.token || process.env.CHITTY_SERVICE_TOKEN;
    this.apiKey = options.apiKey || process.env.CHITTY_API_KEY;
  }

  /**
   * Build authorization headers
   */
  #getHeaders() {
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    } else if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }

    return headers;
  }

  /**
   * Mint a new ChittyID
   *
   * @param {string} entityType - Entity type (person, place, thing, event, authority)
   * @param {Object} [options] - Minting options
   * @param {string} [options.region] - Geographic region (1-9)
   * @param {string} [options.jurisdiction] - Jurisdiction code (USA, GBR, etc.)
   * @param {number} [options.trust] - Requested trust level (0-5)
   * @returns {Promise<MintResult>}
   *
   * @example
   * const result = await client.mint('person');
   * const result = await client.mint('event', { region: '3', jurisdiction: 'GBR' });
   */
  async mint(entityType, options = {}) {
    const params = new URLSearchParams();
    params.set("type", entityType);

    if (options.region) params.set("region", options.region);
    if (options.jurisdiction) params.set("jurisdiction", options.jurisdiction);
    if (options.trust !== undefined)
      params.set("trust", options.trust.toString());

    const response = await fetch(
      `${this.serviceUrl}/api/get-chittyid?${params}`,
      {
        method: "GET",
        headers: this.#getHeaders(),
      },
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: "Unknown error" }));
      throw new ChittyIDError(
        error.error || "MINT_FAILED",
        error.message || response.statusText,
      );
    }

    return response.json();
  }

  /**
   * Validate a ChittyID
   *
   * @param {string} chittyId - The ChittyID to validate
   * @returns {Promise<ValidationResult>}
   *
   * @example
   * const result = await client.validate('03-1-USA-1234-P-2601-3-42');
   * if (result.valid) {
   *   console.log('Entity type:', result.components.entityType);
   * }
   */
  async validate(chittyId) {
    const response = await fetch(`${this.serviceUrl}/api/validate`, {
      method: "POST",
      headers: this.#getHeaders(),
      body: JSON.stringify({ id: chittyId }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: "Unknown error" }));
      throw new ChittyIDError(
        error.error || "VALIDATION_FAILED",
        error.message || response.statusText,
      );
    }

    return response.json();
  }

  /**
   * Get ChittyID specification
   *
   * @returns {Promise<SpecResult>}
   */
  async getSpec() {
    const response = await fetch(`${this.serviceUrl}/api/spec`, {
      method: "GET",
      headers: this.#getHeaders(),
    });

    if (!response.ok) {
      throw new ChittyIDError(
        "SPEC_FAILED",
        "Failed to retrieve specification",
      );
    }

    return response.json();
  }

  /**
   * Check service health
   *
   * @returns {Promise<HealthResult>}
   */
  async health() {
    const response = await fetch(`${this.serviceUrl}/api/health`, {
      method: "GET",
    });

    return response.json();
  }

  /**
   * Parse a ChittyID into its components (client-side, no network call)
   *
   * @param {string} chittyId - The ChittyID to parse
   * @returns {ChittyIDComponents|null}
   */
  static parse(chittyId) {
    if (!chittyId || typeof chittyId !== "string") return null;

    const parts = chittyId.split("-");
    if (parts.length !== 8) return null;

    const [
      version,
      region,
      jurisdiction,
      sequential,
      entityType,
      yearMonth,
      trustLevel,
      checksum,
    ] = parts;

    return {
      version,
      region,
      jurisdiction,
      sequential,
      entityType,
      yearMonth,
      trustLevel,
      checksum,
      // Derived fields
      year: yearMonth.substring(0, 2),
      month: yearMonth.substring(2, 4),
      trustLevelName:
        [
          "Anonymous",
          "Basic",
          "Enhanced",
          "Professional",
          "Institutional",
          "Official",
        ][parseInt(trustLevel)] || "Unknown",
      entityTypeName:
        { P: "Person", L: "Location", T: "Thing", E: "Event", A: "Authority" }[
          entityType
        ] || "Unknown",
    };
  }
}

/**
 * ChittyID Error
 */
export class ChittyIDError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ChittyIDError";
    this.code = code;
  }
}

/**
 * @typedef {Object} MintResult
 * @property {boolean} success
 * @property {string} chittyId
 * @property {ChittyIDComponents} components
 * @property {Object} geo
 * @property {Object} trust
 * @property {Object} drand
 * @property {string} timestamp
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} success
 * @property {boolean} valid
 * @property {ChittyIDComponents} [components]
 * @property {string} [error]
 */

/**
 * @typedef {Object} ChittyIDComponents
 * @property {string} version
 * @property {string} region
 * @property {string} jurisdiction
 * @property {string} sequential
 * @property {string} entityType
 * @property {string} yearMonth
 * @property {string} trustLevel
 * @property {string} checksum
 */

// Default export for convenience
export default ChittyIDClient;
