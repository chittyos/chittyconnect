-- Document Storage Metadata Tables
-- Tracks documents stored in R2 with full-text search capabilities

-- Main documents table
CREATE TABLE IF NOT EXISTS documents (
  document_id TEXT PRIMARY KEY,
  chitty_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('evidence', 'case_file', 'attachment', 'template', 'misc')),
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  storage_path TEXT NOT NULL UNIQUE,
  metadata TEXT, -- JSON string with custom metadata
  uploaded_at INTEGER NOT NULL,
  last_accessed INTEGER,
  access_count INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER, -- Soft delete
  checksum TEXT -- SHA-256 hash for integrity verification
);

CREATE INDEX IF NOT EXISTS idx_documents_chitty_id ON documents(chitty_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_size ON documents(size DESC);
CREATE INDEX IF NOT EXISTS idx_documents_access ON documents(access_count DESC);
CREATE INDEX IF NOT EXISTS idx_documents_active ON documents(deleted_at) WHERE deleted_at IS NULL;

-- Document versions (for versioning support)
CREATE TABLE IF NOT EXISTS document_versions (
  version_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  checksum TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT, -- ChittyID of creator
  change_description TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE,
  UNIQUE(document_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_versions_document ON document_versions(document_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_versions_created ON document_versions(created_at DESC);

-- Document sharing and permissions
CREATE TABLE IF NOT EXISTS document_permissions (
  permission_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chitty_id TEXT NOT NULL, -- Who has permission
  permission_type TEXT NOT NULL CHECK(permission_type IN ('read', 'write', 'delete', 'share')),
  granted_by TEXT NOT NULL, -- ChittyID who granted permission
  granted_at INTEGER NOT NULL,
  expires_at INTEGER, -- NULL = never expires
  revoked_at INTEGER,
  FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_permissions_document ON document_permissions(document_id);
CREATE INDEX IF NOT EXISTS idx_permissions_chitty_id ON document_permissions(chitty_id);
CREATE INDEX IF NOT EXISTS idx_permissions_active ON document_permissions(revoked_at, expires_at)
  WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > unixepoch());

-- Document tags for categorization
CREATE TABLE IF NOT EXISTS document_tags (
  tag_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  tag_value TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE,
  UNIQUE(document_id, tag_name)
);

CREATE INDEX IF NOT EXISTS idx_tags_document ON document_tags(document_id);
CREATE INDEX IF NOT EXISTS idx_tags_name ON document_tags(tag_name, tag_value);

-- Document relationships (links between documents)
CREATE TABLE IF NOT EXISTS document_relationships (
  relationship_id TEXT PRIMARY KEY,
  source_document_id TEXT NOT NULL,
  target_document_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL, -- 'attachment', 'reference', 'derivative', 'supersedes'
  created_at INTEGER NOT NULL,
  metadata TEXT, -- JSON string with additional context
  FOREIGN KEY (source_document_id) REFERENCES documents(document_id) ON DELETE CASCADE,
  FOREIGN KEY (target_document_id) REFERENCES documents(document_id) ON DELETE CASCADE,
  UNIQUE(source_document_id, target_document_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_relationships_source ON document_relationships(source_document_id);
CREATE INDEX IF NOT EXISTS idx_relationships_target ON document_relationships(target_document_id);
CREATE INDEX IF NOT EXISTS idx_relationships_type ON document_relationships(relationship_type);

-- Document access audit log
CREATE TABLE IF NOT EXISTS document_access_log (
  log_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chitty_id TEXT NOT NULL,
  action TEXT NOT NULL, -- 'view', 'download', 'update', 'delete', 'share'
  ip_address TEXT,
  user_agent TEXT,
  success INTEGER NOT NULL DEFAULT 1, -- 0 = failed, 1 = success
  failure_reason TEXT,
  accessed_at INTEGER NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(document_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_access_log_document ON document_access_log(document_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_log_chitty_id ON document_access_log(chitty_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_log_action ON document_access_log(action, accessed_at DESC);

-- Storage quotas per ChittyID
CREATE TABLE IF NOT EXISTS storage_quotas (
  chitty_id TEXT PRIMARY KEY,
  quota_bytes INTEGER NOT NULL DEFAULT 1073741824, -- Default 1GB
  used_bytes INTEGER NOT NULL DEFAULT 0,
  document_count INTEGER NOT NULL DEFAULT 0,
  last_updated INTEGER NOT NULL,
  quota_tier TEXT DEFAULT 'free' -- 'free', 'pro', 'enterprise'
);

CREATE INDEX IF NOT EXISTS idx_quotas_usage ON storage_quotas(used_bytes DESC);

-- Trigger to update storage quotas when documents are added
CREATE TRIGGER IF NOT EXISTS update_quota_on_insert
AFTER INSERT ON documents
BEGIN
  INSERT INTO storage_quotas (chitty_id, used_bytes, document_count, last_updated)
  VALUES (NEW.chitty_id, NEW.size, 1, unixepoch())
  ON CONFLICT(chitty_id) DO UPDATE SET
    used_bytes = used_bytes + NEW.size,
    document_count = document_count + 1,
    last_updated = unixepoch();
END;

-- Trigger to update storage quotas when documents are deleted
CREATE TRIGGER IF NOT EXISTS update_quota_on_delete
AFTER UPDATE OF deleted_at ON documents
WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
BEGIN
  UPDATE storage_quotas
  SET
    used_bytes = used_bytes - NEW.size,
    document_count = document_count - 1,
    last_updated = unixepoch()
  WHERE chitty_id = NEW.chitty_id;
END;

-- Cleanup job tracking (for lifecycle policies)
CREATE TABLE IF NOT EXISTS document_cleanup_jobs (
  job_id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL, -- 'expired_temp', 'soft_delete', 'quota_enforcement'
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
  documents_processed INTEGER DEFAULT 0,
  documents_deleted INTEGER DEFAULT 0,
  bytes_reclaimed INTEGER DEFAULT 0,
  started_at INTEGER,
  completed_at INTEGER,
  error_message TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_cleanup_jobs_status ON document_cleanup_jobs(status, created_at DESC);