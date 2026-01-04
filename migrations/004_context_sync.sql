-- ChittyConnect Context Synchronization Schema
-- Migration 004: Context Files, Tasks, and Sync Events
-- Purpose: Enable cross-channel context synchronization for files and tasks

-- ============================================================================
-- Active Files Tracking
-- ============================================================================
-- Tracks files across all channels (web/desktop/mobile) with session context
CREATE TABLE IF NOT EXISTS context_files (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  chitty_id TEXT NOT NULL,
  file_uri TEXT NOT NULL,              -- r2://{key} or resource://connect/{session}/{sha256}-{name}
  file_name TEXT,
  file_size INTEGER,
  sha256 TEXT,
  mime_type TEXT,
  is_active INTEGER DEFAULT 1,         -- 1 = active, 0 = inactive
  last_accessed INTEGER NOT NULL,      -- Unix timestamp (seconds)
  synced_at INTEGER NOT NULL,          -- Unix timestamp (seconds)
  metadata TEXT,                       -- JSON metadata
  UNIQUE(session_id, file_uri)
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_context_files_session
  ON context_files(session_id, is_active DESC, last_accessed DESC);

CREATE INDEX IF NOT EXISTS idx_context_files_chitty
  ON context_files(chitty_id, synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_context_files_sha256
  ON context_files(sha256);

-- ============================================================================
-- Task Tracking
-- ============================================================================
-- Tracks tasks across all channels with status, priority, and relationships
CREATE TABLE IF NOT EXISTS context_tasks (
  task_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  chitty_id TEXT NOT NULL,
  task_type TEXT NOT NULL,             -- 'user_request', 'background_job', 'scheduled'
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
  assigned_service TEXT,               -- Which ChittyOS service is handling this
  parent_task_id TEXT,                 -- For sub-tasks
  created_at INTEGER NOT NULL,         -- Unix timestamp (seconds)
  updated_at INTEGER NOT NULL,         -- Unix timestamp (seconds)
  started_at INTEGER,                  -- Unix timestamp (seconds)
  completed_at INTEGER,                -- Unix timestamp (seconds)
  metadata TEXT,                       -- JSON metadata
  result TEXT,                         -- JSON result when completed
  error TEXT,                          -- Error details if failed
  FOREIGN KEY (parent_task_id) REFERENCES context_tasks(task_id) ON DELETE CASCADE
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_context_tasks_session
  ON context_tasks(session_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_context_tasks_chitty
  ON context_tasks(chitty_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_context_tasks_status
  ON context_tasks(status, priority DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_context_tasks_service
  ON context_tasks(assigned_service, status);

-- ============================================================================
-- Sync Events Log
-- ============================================================================
-- Records all sync events (rclone, desktop client, etc.) for auditing
CREATE TABLE IF NOT EXISTS sync_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,            -- 'file_sync', 'task_update', 'context_update'
  source TEXT NOT NULL,                -- 'rclone', 'desktop_client', 'mcp', 'api'
  items_count INTEGER DEFAULT 0,
  bytes_synced INTEGER DEFAULT 0,
  status TEXT DEFAULT 'success' CHECK(status IN ('success', 'partial', 'failed')),
  error_message TEXT,
  synced_at INTEGER NOT NULL,          -- Unix timestamp (seconds)
  metadata TEXT                        -- JSON metadata
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_sync_events_session
  ON sync_events(session_id, synced_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_events_type
  ON sync_events(event_type, synced_at DESC);

-- ============================================================================
-- Notes
-- ============================================================================
-- All timestamps use Unix epoch in seconds (Math.floor(Date.now() / 1000))
-- All IDs use crypto.randomUUID() (v4 UUIDs)
-- File URIs follow: r2://{key} or resource://connect/{session}/{sha256}-{basename}
-- Metadata fields store JSON as TEXT (use JSON.stringify/JSON.parse)
-- Deployed via: wrangler d1 execute chittyconnect-production --file migrations/004_context_sync.sql
