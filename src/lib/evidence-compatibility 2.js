/**
 * Evidence Compatibility Layer
 *
 * Provides backward compatibility for ChittyEvidence v1.0 -> v2.0 migration
 * Maps between old evidence_registry schema and new ChittyLedger schema
 *
 * ChittyEvidence v1.0 (Old):
 * - evidence_registry table
 * - Integer IDs
 * - file_hash primary lookup
 * - Fields: id, chitty_id, file_hash, exhibit_id, category, tags, metadata
 *
 * ChittyEvidence v2.0 (New):
 * - things + evidence tables (ChittyLedger)
 * - UUID IDs
 * - evidence_id primary lookup
 * - Fields: evidence_id, thing_id, case_id, evidence_tier, chain_of_custody_verified
 */

export class EvidenceCompatibilityLayer {
  constructor(env) {
    this.env = env;
  }

  /**
   * Transform ChittyLedger v2.0 response to legacy v1.0 format
   *
   * @param {object} evidence - Evidence from ChittyLedger schema
   * @returns {object} Legacy format evidence
   */
  transformToLegacyFormat(evidence) {
    // ChittyLedger v2.0 structure (joined evidence + things):
    // {
    //   evidence_id: UUID,
    //   thing_id: UUID,
    //   case_id: UUID,
    //   evidence_tier: 'L1',
    //   evidence_number: 'EX001',
    //   chain_of_custody_verified: true,
    //   document_type: 'affidavit',
    //   file_hash: 'abc123...',
    //   name: 'document.pdf',
    //   file_size: 12345,
    //   mime_type: 'application/pdf',
    //   ...
    // }

    return {
      // Legacy integer ID (fake it from UUID hash)
      id: this.uuidToLegacyId(evidence.evidence_id),

      // Map case_id to chitty_id (ChittyEvidence used case ChittyID)
      chitty_id: evidence.case_chitty_id || evidence.case_id,

      // Keep file_hash for backward compat
      file_hash: evidence.file_hash,

      // Map original_name to name
      original_name: evidence.name || evidence.original_filename,

      // Map evidence_number to exhibit_id
      exhibit_id: evidence.evidence_number,

      // Map document_type to category
      category: this.mapDocumentTypeToCategory(evidence.document_type),

      // Map ai_extracted_entities to tags
      tags: evidence.ai_extracted_entities || [],

      // Combine metadata
      metadata: {
        file_size: evidence.file_size,
        mime_type: evidence.mime_type,
        evidence_tier: evidence.evidence_tier,
        thing_id: evidence.thing_id, // Include for migration
        evidence_id: evidence.evidence_id, // Include for migration
        priority_score: evidence.priority_score,
        storage_location: evidence.storage_location,
        ...(evidence.custom_metadata || {}),
      },

      // Map chain_of_custody JSON to legacy array format
      chain_of_custody: this.transformChainOfCustody(evidence),

      // Timestamps
      created_at: evidence.created_at,
      updated_at: evidence.updated_at,

      // Add migration hint
      _schema_version: "2.0_legacy_compat",
      _use_evidence_id: evidence.evidence_id,
    };
  }

  /**
   * Transform legacy v1.0 request to ChittyLedger v2.0 format
   *
   * @param {object} legacyRequest - Legacy evidence request
   * @returns {object} ChittyLedger format request
   */
  transformFromLegacyFormat(legacyRequest) {
    return {
      // Map chitty_id to case_id
      case_id: legacyRequest.caseId || legacyRequest.chitty_id,

      // Map category to document_type
      document_type: this.mapCategoryToDocumentType(
        legacyRequest.category || legacyRequest.evidenceType,
      ),

      // Map exhibit_id to evidence_number (if provided)
      evidence_number: legacyRequest.exhibit_id,

      // Map tags to ai_extracted_entities
      ai_extracted_entities: legacyRequest.tags || [],

      // Map metadata
      custom_metadata: {
        ...legacyRequest.metadata,
        legacy_migration: true,
        original_category: legacyRequest.category,
      },

      // File information
      file_hash: legacyRequest.file_hash,
      original_filename: legacyRequest.original_name || legacyRequest.fileName,
      file_size: legacyRequest.metadata?.file_size,
      mime_type: legacyRequest.metadata?.mime_type,
    };
  }

  /**
   * Convert UUID to fake legacy integer ID
   * Uses first 8 hex chars converted to int32
   *
   * @param {string} uuid - UUID evidence_id
   * @returns {number} Fake integer ID
   */
  uuidToLegacyId(uuid) {
    if (!uuid) return 0;

    // Take first 8 characters of UUID, convert to int
    const hex = uuid.replace(/-/g, "").substring(0, 8);
    return parseInt(hex, 16) >>> 0; // Unsigned 32-bit integer
  }

  /**
   * Map ChittyLedger document_type to legacy category
   *
   * @param {string} documentType - ChittyLedger document_type
   * @returns {string} Legacy category
   */
  mapDocumentTypeToCategory(documentType) {
    const mapping = {
      affidavit: "01_TRO_PROCEEDINGS",
      motion: "07_COURT_FILINGS",
      petition: "07_COURT_FILINGS",
      order: "07_COURT_FILINGS",
      transcript: "01_TRO_PROCEEDINGS",
      deposition: "01_TRO_PROCEEDINGS",
      contract: "02_LLC_FORMATION",
      agreement: "02_LLC_FORMATION",
      deed: "05_PROPERTY_TRANSACTIONS",
      mortgage: "05_PROPERTY_TRANSACTIONS",
      bank_statement: "06_FINANCIAL_STATEMENTS",
      financial_record: "06_FINANCIAL_STATEMENTS",
      correspondence: "08_ATTORNEY_CORRESPONDENCE",
      email: "08_ATTORNEY_CORRESPONDENCE",
      lease: "12_LEASE_AGREEMENTS",
      photo: "00_KEY_EXHIBITS",
      video: "00_KEY_EXHIBITS",
      other: "99_UNSORTED",
    };

    return mapping[documentType] || "99_UNSORTED";
  }

  /**
   * Map legacy category to ChittyLedger document_type
   *
   * @param {string} category - Legacy category
   * @returns {string} ChittyLedger document_type
   */
  mapCategoryToDocumentType(category) {
    if (!category) return "other";

    const mapping = {
      "00_KEY_EXHIBITS": "key_evidence",
      "01_TRO_PROCEEDINGS": "affidavit",
      "02_LLC_FORMATION": "contract",
      "03_MEMBERSHIP_REMOVAL": "legal_notice",
      "04_PREMARITAL_FUNDING": "financial_record",
      "05_PROPERTY_TRANSACTIONS": "deed",
      "06_FINANCIAL_STATEMENTS": "bank_statement",
      "07_COURT_FILINGS": "motion",
      "08_ATTORNEY_CORRESPONDENCE": "correspondence",
      "09_PERJURY_EVIDENCE": "sworn_statement",
      "10_SANCTIONS_RULE137": "motion",
      "11_COLOMBIAN_PROPERTY": "property_record",
      "12_LEASE_AGREEMENTS": "lease",
      "98_DUPLICATES": "duplicate",
      "99_UNSORTED": "other",
    };

    return mapping[category] || "other";
  }

  /**
   * Transform chain of custody from ChittyLedger format to legacy array
   *
   * @param {object} evidence - Evidence record
   * @returns {array} Legacy chain of custody events
   */
  transformChainOfCustody(evidence) {
    // ChittyLedger stores chain_of_custody as JSONB in evidence table
    // Legacy format expected array of events

    if (evidence.chain_of_custody_events) {
      return evidence.chain_of_custody_events;
    }

    // If not provided, construct basic chain from metadata
    const events = [];

    if (evidence.created_at) {
      events.push({
        event_type: "registered",
        timestamp: evidence.created_at,
        actor: "chittyevidence_v2",
        details: "Evidence registered in ChittyLedger",
      });
    }

    if (evidence.chain_of_custody_verified) {
      events.push({
        event_type: "verified",
        timestamp: evidence.custody_verified_at || evidence.updated_at,
        actor: "chittyevidence_v2",
        details: "Chain of custody verified",
      });
    }

    return events;
  }

  /**
   * Query evidence by file_hash using ChittyLedger schema
   * This provides backward compatibility for file_hash lookups
   *
   * @param {string} fileHash - SHA256 file hash
   * @returns {Promise<object|null>} Evidence record or null
   */
  async getEvidenceByFileHash(fileHash) {
    try {
      // Query ChittyLedger schema (things table has file_hash)
      // This assumes ChittyConnect has access to the shared database
      const result = await this.env.DB.prepare(
        `
        SELECT
          e.id as evidence_id,
          e.thing_id,
          e.case_id,
          e.evidence_tier,
          e.evidence_number,
          e.chain_of_custody_verified,
          e.custody_verified_at,
          e.created_at,
          e.updated_at,
          t.name,
          t.type,
          t.file_hash,
          t.file_size,
          t.mime_type,
          t.storage_location,
          t.document_type,
          t.ai_extracted_entities,
          t.ai_content_summary,
          t.priority_score,
          t.custom_metadata,
          c.chitty_id as case_chitty_id
        FROM evidence e
        JOIN things t ON e.thing_id = t.id
        LEFT JOIN cases c ON e.case_id = c.id
        WHERE t.file_hash = ?
        LIMIT 1
      `,
      )
        .bind(fileHash)
        .first();

      if (!result) {
        return null;
      }

      // Parse JSON fields
      return {
        ...result,
        ai_extracted_entities: JSON.parse(result.ai_extracted_entities || "[]"),
        custom_metadata: JSON.parse(result.custom_metadata || "{}"),
      };
    } catch (error) {
      console.error("[EvidenceCompat] File hash lookup error:", error);
      return null;
    }
  }

  /**
   * Check if evidence exists by either evidence_id or file_hash
   *
   * @param {string} identifier - UUID or file_hash
   * @returns {Promise<boolean>} True if exists
   */
  async evidenceExists(identifier) {
    const isUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        identifier,
      );

    try {
      if (isUUID) {
        // Check by evidence_id
        const result = await this.env.DB.prepare(
          `
          SELECT 1 FROM evidence WHERE id = ?::uuid
        `,
        )
          .bind(identifier)
          .first();

        return !!result;
      } else {
        // Check by file_hash
        const result = await this.env.DB.prepare(
          `
          SELECT 1 FROM evidence e
          JOIN things t ON e.thing_id = t.id
          WHERE t.file_hash = ?
        `,
        )
          .bind(identifier)
          .first();

        return !!result;
      }
    } catch (error) {
      console.error("[EvidenceCompat] Exists check error:", error);
      return false;
    }
  }

  /**
   * Get evidence with full backward compatibility
   * Tries UUID first, falls back to file_hash
   *
   * @param {string} identifier - UUID or file_hash
   * @returns {Promise<object|null>} Evidence record
   */
  async getEvidence(identifier) {
    const isUUID =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        identifier,
      );

    if (isUUID) {
      // Query by evidence_id
      const result = await this.env.DB.prepare(
        `
        SELECT
          e.id as evidence_id,
          e.thing_id,
          e.case_id,
          e.evidence_tier,
          e.evidence_number,
          e.chain_of_custody_verified,
          e.custody_verified_at,
          e.created_at,
          e.updated_at,
          t.name,
          t.type,
          t.file_hash,
          t.file_size,
          t.mime_type,
          t.storage_location,
          t.document_type,
          t.ai_extracted_entities,
          t.ai_content_summary,
          t.priority_score,
          t.custom_metadata,
          c.chitty_id as case_chitty_id
        FROM evidence e
        JOIN things t ON e.thing_id = t.id
        LEFT JOIN cases c ON e.case_id = c.id
        WHERE e.id = ?::uuid
      `,
      )
        .bind(identifier)
        .first();

      if (result) {
        return {
          ...result,
          ai_extracted_entities: JSON.parse(
            result.ai_extracted_entities || "[]",
          ),
          custom_metadata: JSON.parse(result.custom_metadata || "{}"),
        };
      }
    }

    // Fall back to file_hash lookup
    return await this.getEvidenceByFileHash(identifier);
  }

  /**
   * Migrate legacy evidence references to new UUIDs
   * Useful for updating ContextConsciousness and MemoryCloude
   *
   * @param {array} legacyReferences - Array of file_hashes or legacy IDs
   * @returns {Promise<array>} Array of evidence_id UUIDs
   */
  async migrateReferences(legacyReferences) {
    const migrated = [];

    for (const ref of legacyReferences) {
      // Skip if already UUID
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          ref,
        )
      ) {
        migrated.push(ref);
        continue;
      }

      // Try to find by file_hash
      const evidence = await this.getEvidenceByFileHash(ref);
      if (evidence) {
        migrated.push(evidence.evidence_id);
      } else {
        console.warn(`[EvidenceCompat] Could not migrate reference: ${ref}`);
      }
    }

    return migrated;
  }
}

export default EvidenceCompatibilityLayer;
