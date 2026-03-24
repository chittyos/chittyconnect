-- tenant_base_001: Evidence Storage
-- Runs on each new tenant Neon project (PostgreSQL).
-- Stores tenant-owned evidence originals, custody logs, and document families.
-- Work product stays in platform DB — only non-privileged evidence lands here.

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
      CHECK (privilege_flag IN ('none', 'possible_ac', 'work_product', 'needs_review')),
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

-- Custody log: immutable chain of custody for evidence
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

-- Document families: parent/child groupings (email→attachments, filing→exhibits)
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
