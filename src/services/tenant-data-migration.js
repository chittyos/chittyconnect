/**
 * Tenant Data Migration Service (Phase 5)
 *
 * Migrates existing evidence data from the shared chittyevidence-db D1
 * to per-tenant Neon projects. Supports dry-run mode, per-client migration,
 * and progress tracking.
 *
 * Flow:
 *   1. Query shared DB for distinct client_ids with document counts
 *   2. For each client: provision tenant project (if needed)
 *   3. Replicate non-privileged documents to tenant Neon
 *   4. Replicate associated custody logs and document families
 *
 * @module services/tenant-data-migration
 */

import { TenantProjectManager } from "./tenant-project-manager.js";
import { queryTenantDb } from "../lib/tenant-connection-router.js";

const EVIDENCE_SERVICE_URL = "https://evidence.chitty.cc";
const BATCH_SIZE = 50;

export class TenantDataMigration {
  constructor(env) {
    this.env = env;
    this.manager = new TenantProjectManager(env);
  }

  /**
   * Discover all clients with evidence in the shared DB
   * @returns {Promise<{clients: Array<{clientId: string, documentCount: number}>}>}
   */
  async discoverClients() {
    const result = await this.#queryEvidenceDb(
      `SELECT client_id, COUNT(*) as doc_count
       FROM evidence_documents
       WHERE client_id IS NOT NULL AND client_id != ''
       GROUP BY client_id
       ORDER BY doc_count DESC`,
    );

    return {
      clients: (result.results || []).map((r) => ({
        clientId: r.client_id,
        documentCount: r.doc_count,
      })),
    };
  }

  /**
   * Plan the migration without executing it
   * @param {object} [options]
   * @param {string} [options.clientId] - Migrate a specific client only
   * @returns {Promise<object>} Migration plan with counts and estimated actions
   */
  async plan(options = {}) {
    const clients = options.clientId
      ? [{ clientId: options.clientId, documentCount: 0 }]
      : (await this.discoverClients()).clients;

    const plan = {
      mode: "dry-run",
      totalClients: clients.length,
      clients: [],
      totals: { documents: 0, custodyLogs: 0, families: 0, alreadyProvisioned: 0, needsProvisioning: 0 },
    };

    for (const client of clients) {
      const existing = await this.manager.getTenantRecord(client.clientId);

      // Count documents eligible for replication (non-privileged)
      const docResult = await this.#queryEvidenceDb(
        `SELECT COUNT(*) as cnt FROM evidence_documents
         WHERE client_id = ? AND (privilege_flag IS NULL OR privilege_flag IN ('none', 'possible_ac', 'needs_review'))`,
        [client.clientId],
      );

      // Count custody logs for those documents
      const custodyResult = await this.#queryEvidenceDb(
        `SELECT COUNT(*) as cnt FROM evidence_chain_of_custody
         WHERE document_id IN (
           SELECT id FROM evidence_documents
           WHERE client_id = ? AND (privilege_flag IS NULL OR privilege_flag IN ('none', 'possible_ac', 'needs_review'))
         )`,
        [client.clientId],
      );

      // Count document families
      const familyResult = await this.#queryEvidenceDb(
        `SELECT COUNT(*) as cnt FROM evidence_document_families
         WHERE parent_document_id IN (
           SELECT id FROM evidence_documents WHERE client_id = ?
         ) OR child_document_id IN (
           SELECT id FROM evidence_documents WHERE client_id = ?
         )`,
        [client.clientId, client.clientId],
      );

      const docCount = docResult.results?.[0]?.cnt || 0;
      const custodyCount = custodyResult.results?.[0]?.cnt || 0;
      const familyCount = familyResult.results?.[0]?.cnt || 0;

      plan.clients.push({
        clientId: client.clientId,
        alreadyProvisioned: !!existing,
        documents: docCount,
        custodyLogs: custodyCount,
        families: familyCount,
      });

      plan.totals.documents += docCount;
      plan.totals.custodyLogs += custodyCount;
      plan.totals.families += familyCount;
      if (existing) plan.totals.alreadyProvisioned++;
      else plan.totals.needsProvisioning++;
    }

    return plan;
  }

  /**
   * Execute the migration for one or all clients
   * @param {object} [options]
   * @param {string} [options.clientId] - Migrate a specific client only
   * @param {boolean} [options.dryRun] - If true, only plan without executing
   * @param {string} [options.region] - Neon region for new projects
   * @returns {Promise<object>} Migration results
   */
  async execute(options = {}) {
    if (options.dryRun) {
      return this.plan(options);
    }

    const clients = options.clientId
      ? [{ clientId: options.clientId }]
      : (await this.discoverClients()).clients;

    const results = {
      mode: "execute",
      startedAt: new Date().toISOString(),
      clients: [],
      totals: { provisioned: 0, documents: 0, custodyLogs: 0, families: 0, financialRecords: 0, errors: 0 },
    };

    for (const client of clients) {
      const clientResult = await this.#migrateClient(client.clientId, options);
      results.clients.push(clientResult);

      if (clientResult.error) {
        results.totals.errors++;
      } else {
        if (clientResult.provisioned) results.totals.provisioned++;
        results.totals.documents += clientResult.documents;
        results.totals.custodyLogs += clientResult.custodyLogs;
        results.totals.families += clientResult.families;
        results.totals.financialRecords += clientResult.financialRecords;
      }
    }

    results.completedAt = new Date().toISOString();
    return results;
  }

  /**
   * Migrate a single client's data
   * @param {string} clientId
   * @param {object} options
   * @returns {Promise<object>}
   */
  async #migrateClient(clientId, options = {}) {
    const result = {
      clientId,
      provisioned: false,
      documents: 0,
      custodyLogs: 0,
      families: 0,
      financialRecords: 0,
      error: null,
    };

    try {
      // Step 1: Ensure tenant project exists
      let tenant = await this.manager.getTenantRecord(clientId);
      if (!tenant) {
        await this.manager.provisionTenant(clientId, {
          region: options.region || "aws-us-east-2",
        });
        tenant = await this.manager.getTenantRecord(clientId);
        result.provisioned = true;
      }

      // Step 2: Migrate documents in batches
      result.documents = await this.#migrateDocuments(clientId);

      // Step 3: Migrate custody logs
      result.custodyLogs = await this.#migrateCustodyLogs(clientId);

      // Step 4: Migrate document families
      result.families = await this.#migrateDocumentFamilies(clientId);

      // Step 5: Migrate financial records
      result.financialRecords = await this.#migrateFinancialRecords(clientId);
    } catch (error) {
      result.error = error.message;
    }

    return result;
  }

  /**
   * Migrate documents for a client in batches
   * @param {string} clientId
   * @returns {Promise<number>} Count of migrated documents
   */
  async #migrateDocuments(clientId) {
    let total = 0;
    let offset = 0;

    while (true) {
      const batch = await this.#queryEvidenceDb(
        `SELECT id, document_type, file_name, file_size, mime_type, content_hash,
                r2_key, ocr_text, metadata, processing_status, privilege_flag,
                privilege_basis, evidence_strength, evidence_strength_rationale,
                uploaded_by, client_id, superseded_by, supersedes, created_at, updated_at
         FROM evidence_documents
         WHERE client_id = ?
           AND (privilege_flag IS NULL OR privilege_flag IN ('none', 'possible_ac', 'needs_review'))
         ORDER BY created_at
         LIMIT ? OFFSET ?`,
        [clientId, BATCH_SIZE, offset],
      );

      const rows = batch.results || [];
      if (rows.length === 0) break;

      for (const doc of rows) {
        await this.#replicateRecord(clientId, "evidence_documents", {
          id: doc.id,
          document_type: doc.document_type,
          file_name: doc.file_name,
          file_size: doc.file_size,
          mime_type: doc.mime_type,
          content_hash: doc.content_hash,
          r2_key: doc.r2_key,
          ocr_text: doc.ocr_text,
          metadata: typeof doc.metadata === "string" ? doc.metadata : JSON.stringify(doc.metadata || {}),
          processing_status: "replicated",
          privilege_flag: doc.privilege_flag || "none",
          privilege_basis: doc.privilege_basis,
          evidence_strength: doc.evidence_strength,
          evidence_strength_rationale: doc.evidence_strength_rationale,
          uploaded_by: doc.uploaded_by,
          client_id: doc.client_id,
          superseded_by: doc.superseded_by,
          supersedes: doc.supersedes,
          replicated_at: new Date().toISOString(),
          source: "migration-phase5",
          created_at: doc.created_at,
          updated_at: doc.updated_at,
        });
        total++;
      }

      offset += BATCH_SIZE;
      if (rows.length < BATCH_SIZE) break;
    }

    return total;
  }

  /**
   * Migrate custody logs for a client's documents
   * @param {string} clientId
   * @returns {Promise<number>}
   */
  async #migrateCustodyLogs(clientId) {
    let total = 0;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const batch = await this.#queryEvidenceDb(
        `SELECT ec.id, ec.document_id, ec.custodian, ec.custody_action,
                ec.location, ec.notes, ec.verification_method, ec.created_at
         FROM evidence_chain_of_custody ec
         INNER JOIN evidence_documents ed ON ec.document_id = ed.id
         WHERE ed.client_id = ?
           AND (ed.privilege_flag IS NULL OR ed.privilege_flag IN ('none', 'possible_ac', 'needs_review'))
         ORDER BY ec.created_at
         LIMIT ? OFFSET ?`,
        [clientId, BATCH_SIZE, offset],
      );

      const rows = batch.results || [];
      if (rows.length === 0) break;

      for (const log of rows) {
        // Map source columns (evidence_chain_of_custody) to target (evidence_custody_log)
        const details = JSON.stringify({
          location: log.location || null,
          notes: log.notes || null,
          verification_method: log.verification_method || null,
        });
        await this.#replicateRecord(clientId, "evidence_custody_log", {
          id: log.id,
          document_id: log.document_id,
          action: log.custody_action || "unknown",
          actor: log.custodian || "unknown",
          actor_type: "service",
          details,
          created_at: log.created_at,
        });
        total++;
      }

      offset += BATCH_SIZE;
      if (rows.length < BATCH_SIZE) break;
    }

    return total;
  }

  /**
   * Migrate document families for a client's documents
   * @param {string} clientId
   * @returns {Promise<number>}
   */
  async #migrateDocumentFamilies(clientId) {
    let total = 0;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const batch = await this.#queryEvidenceDb(
        `SELECT df.id, df.parent_document_id, df.child_document_id,
                df.family_role, df.ordinal, df.notes, df.created_at
         FROM evidence_document_families df
         WHERE df.parent_document_id IN (
           SELECT id FROM evidence_documents WHERE client_id = ?
         ) OR df.child_document_id IN (
           SELECT id FROM evidence_documents WHERE client_id = ?
         )
         ORDER BY df.created_at
         LIMIT ? OFFSET ?`,
        [clientId, clientId, BATCH_SIZE, offset],
      );

      const rows = batch.results || [];
      if (rows.length === 0) break;

      for (const fam of rows) {
        await this.#replicateRecord(clientId, "document_families", {
          id: fam.id,
          parent_document_id: fam.parent_document_id,
          child_document_id: fam.child_document_id,
          family_role: fam.family_role,
          ordinal: fam.ordinal,
          notes: fam.notes,
          created_at: fam.created_at,
        });
        total++;
      }

      offset += BATCH_SIZE;
      if (rows.length < BATCH_SIZE) break;
    }

    return total;
  }

  /**
   * Migrate financial records linked to a client's documents
   * @param {string} clientId
   * @returns {Promise<number>}
   */
  async #migrateFinancialRecords(clientId) {
    let total = 0;
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const batch = await this.#queryEvidenceDb(
        `SELECT fr.id, fr.record_type, fr.description, fr.amount, fr.currency,
                fr.date, fr.counterparty, fr.account_reference, fr.metadata,
                fr.source_document_id, fr.created_at, fr.updated_at
         FROM financial_records fr
         INNER JOIN client_documents cd ON fr.source_document_id = cd.id
         WHERE cd.uploaded_by IN (
           SELECT DISTINCT uploaded_by FROM evidence_documents WHERE client_id = ?
         )
         ORDER BY fr.created_at
         LIMIT ? OFFSET ?`,
        [clientId, BATCH_SIZE, offset],
      );

      const rows = batch.results || [];
      if (rows.length === 0) break;

      for (const rec of rows) {
        await this.#replicateRecord(clientId, "financial_records", {
          id: rec.id,
          record_type: rec.record_type,
          description: rec.description,
          amount: rec.amount,
          currency: rec.currency || "USD",
          date: rec.date,
          counterparty: rec.counterparty,
          account_reference: rec.account_reference,
          metadata: typeof rec.metadata === "string" ? rec.metadata : JSON.stringify(rec.metadata || {}),
          source_document_id: rec.source_document_id,
          created_at: rec.created_at,
          updated_at: rec.updated_at,
        });
        total++;
      }

      offset += BATCH_SIZE;
      if (rows.length < BATCH_SIZE) break;
    }

    return total;
  }

  /**
   * Replicate a single record to the tenant's Neon project
   * Uses queryTenantDb which resolves the connection via KV/D1
   */
  async #replicateRecord(tenantId, table, record) {
    const columns = Object.keys(record).filter((k) => record[k] !== undefined);
    const values = columns.map((k) => record[k]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const updateSet = columns
      .filter((c) => c !== "id")
      .map((col) => `${col} = $${columns.indexOf(col) + 1}`)
      .join(", ");

    const sql = `INSERT INTO ${table} (${columns.join(", ")})
      VALUES (${placeholders})
      ON CONFLICT (id) DO UPDATE SET ${updateSet}`;

    await queryTenantDb(this.env, tenantId, sql, values);
  }

  /**
   * Query the shared evidence DB via service call
   * ChittyEvidence exposes D1 — we call it directly from ChittyConnect
   */
  async #queryEvidenceDb(sql, params = []) {
    // Use the Cloudflare D1 HTTP API via the evidence service binding
    // or fall back to the evidence service's API
    const token = this.env.CHITTY_EVIDENCE_TOKEN || this.env.CHITTYCONNECT_SERVICE_TOKEN;

    const response = await fetch(`${EVIDENCE_SERVICE_URL}/api/v1/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ sql, params }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Evidence DB query failed: ${response.status} — ${body}`);
    }

    return response.json();
  }
}
