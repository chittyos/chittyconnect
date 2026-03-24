-- tenant_base_002: Client Data
-- Stores client-owned documents and financial records in the tenant's
-- isolated Neon project. Fully portable — tenant can export entire project.

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

-- Schema version tracking for tenant migrations
CREATE TABLE IF NOT EXISTS _tenant_schema_version (
    version INTEGER PRIMARY KEY,
    migration_name TEXT NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO _tenant_schema_version (version, migration_name) VALUES
  (1, '001_evidence_storage'),
  (2, '002_client_data')
ON CONFLICT (version) DO NOTHING;
