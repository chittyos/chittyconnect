/**
 * Tenant Migration Runner
 *
 * Runs base PostgreSQL migrations on newly provisioned tenant Neon projects.
 * Migrations are defined inline (not read from filesystem) since Cloudflare
 * Workers don't have filesystem access at runtime.
 *
 * @module lib/tenant-migrations
 */

import { Client } from "@neondatabase/serverless";

/**
 * Ordered list of tenant base migrations.
 * Each migration runs once per tenant project during provisioning.
 */
const TENANT_MIGRATIONS = [
  {
    version: 1,
    name: "001_evidence_storage",
    sql: `
      CREATE TABLE IF NOT EXISTS evidence_documents (
        id TEXT PRIMARY KEY,
        document_type TEXT,
        file_name TEXT NOT NULL,
        file_size INTEGER,
        mime_type TEXT,
        content_hash TEXT UNIQUE,
        r2_key TEXT,
        ocr_text TEXT,
        metadata JSONB DEFAULT '{}',
        processing_status TEXT DEFAULT 'replicated',
        privilege_flag TEXT DEFAULT 'none'
          CHECK (privilege_flag IN ('none', 'possible_ac', 'needs_review')),
        privilege_basis TEXT,
        evidence_strength INTEGER CHECK (evidence_strength BETWEEN 1 AND 5),
        evidence_strength_rationale TEXT,
        uploaded_by TEXT,
        client_id TEXT,
        superseded_by TEXT REFERENCES evidence_documents(id),
        supersedes TEXT REFERENCES evidence_documents(id),
        replicated_at TIMESTAMPTZ,
        source TEXT DEFAULT 'chittyevidence-db',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_tenant_docs_hash ON evidence_documents(content_hash);
      CREATE INDEX IF NOT EXISTS idx_tenant_docs_type ON evidence_documents(document_type);
      CREATE INDEX IF NOT EXISTS idx_tenant_docs_status ON evidence_documents(processing_status);
      CREATE INDEX IF NOT EXISTS idx_tenant_docs_client ON evidence_documents(client_id);
      CREATE INDEX IF NOT EXISTS idx_tenant_docs_created ON evidence_documents(created_at);

      CREATE TABLE IF NOT EXISTS evidence_custody_log (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES evidence_documents(id),
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        actor_type TEXT DEFAULT 'service',
        details JSONB DEFAULT '{}',
        ip_address TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_custody_doc ON evidence_custody_log(document_id);
      CREATE INDEX IF NOT EXISTS idx_custody_created ON evidence_custody_log(created_at);

      CREATE TABLE IF NOT EXISTS document_families (
        id TEXT PRIMARY KEY,
        parent_document_id TEXT NOT NULL REFERENCES evidence_documents(id),
        child_document_id TEXT NOT NULL REFERENCES evidence_documents(id),
        family_role TEXT NOT NULL
          CHECK (family_role IN (
            'email_attachment', 'filing_exhibit', 'container_member',
            'amendment', 'translation', 'derivative'
          )),
        ordinal INTEGER,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(parent_document_id, child_document_id)
      );
      CREATE INDEX IF NOT EXISTS idx_families_parent ON document_families(parent_document_id);
      CREATE INDEX IF NOT EXISTS idx_families_child ON document_families(child_document_id);
    `,
  },
  {
    version: 2,
    name: "002_client_data",
    sql: `
      CREATE TABLE IF NOT EXISTS client_documents (
        id TEXT PRIMARY KEY,
        document_type TEXT NOT NULL,
        title TEXT,
        description TEXT,
        file_name TEXT,
        r2_key TEXT,
        content_hash TEXT UNIQUE,
        metadata JSONB DEFAULT '{}',
        status TEXT DEFAULT 'active'
          CHECK (status IN ('active', 'archived', 'deleted')),
        uploaded_by TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_client_docs_type ON client_documents(document_type);
      CREATE INDEX IF NOT EXISTS idx_client_docs_status ON client_documents(status);

      CREATE TABLE IF NOT EXISTS financial_records (
        id TEXT PRIMARY KEY,
        record_type TEXT NOT NULL,
        description TEXT,
        amount NUMERIC(15,2),
        currency TEXT DEFAULT 'USD',
        date DATE,
        counterparty TEXT,
        account_reference TEXT,
        metadata JSONB DEFAULT '{}',
        source_document_id TEXT REFERENCES client_documents(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_financial_type ON financial_records(record_type);
      CREATE INDEX IF NOT EXISTS idx_financial_date ON financial_records(date);
      CREATE INDEX IF NOT EXISTS idx_financial_counterparty ON financial_records(counterparty);

      CREATE TABLE IF NOT EXISTS _tenant_schema_version (
        version INTEGER PRIMARY KEY,
        migration_name TEXT NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  },
];

/**
 * Run all pending migrations on a tenant's Neon database.
 *
 * @param {string} connectionUri - Neon connection string
 * @returns {Promise<{applied: number, total: number}>}
 */
export async function runTenantMigrations(connectionUri) {
  const client = new Client({ connectionString: connectionUri });
  try {
    await client.connect();

    // Ensure schema version table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _tenant_schema_version (
        version INTEGER PRIMARY KEY,
        migration_name TEXT NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Get already-applied versions
    const { rows } = await client.query(
      "SELECT version FROM _tenant_schema_version ORDER BY version",
    );
    const appliedVersions = new Set(rows.map((r) => r.version));

    let applied = 0;
    for (const migration of TENANT_MIGRATIONS) {
      if (appliedVersions.has(migration.version)) continue;

      await client.query(migration.sql);
      await client.query(
        "INSERT INTO _tenant_schema_version (version, migration_name) VALUES ($1, $2)",
        [migration.version, migration.name],
      );
      applied++;
    }

    return { applied, total: TENANT_MIGRATIONS.length };
  } finally {
    await client.end().catch(() => {});
  }
}

export { TENANT_MIGRATIONS };
