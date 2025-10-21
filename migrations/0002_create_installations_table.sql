-- Migration: Create installations table
-- Description: Store GitHub App installations with ChittyID tracking
-- Created: 2025-10-21

CREATE TABLE IF NOT EXISTS installations (
  -- Primary identifier (GitHub installation ID)
  installation_id INTEGER PRIMARY KEY NOT NULL,

  -- ChittyOS integration
  chitty_id TEXT NOT NULL UNIQUE,  -- ChittyID for this installation
  chitty_dna_id TEXT DEFAULT NULL,  -- ChittyDNA tracking

  -- GitHub account information
  account_id INTEGER NOT NULL,
  account_login TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK(account_type IN ('User', 'Organization')),
  account_avatar_url TEXT DEFAULT NULL,

  -- Installation configuration
  repository_selection TEXT NOT NULL CHECK(repository_selection IN ('all', 'selected')),

  -- Permissions snapshot (JSON)
  permissions TEXT DEFAULT '{}',

  -- Events this installation subscribes to (JSON array)
  events TEXT DEFAULT '[]',

  -- Selected repositories (if repository_selection = 'selected', JSON array)
  selected_repositories TEXT DEFAULT '[]',

  -- Suspended status
  suspended_at TEXT DEFAULT NULL,
  suspended_by_chitty_id TEXT DEFAULT NULL,

  -- Timestamps
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  uninstalled_at TEXT DEFAULT NULL
);

-- Index for ChittyID lookups
CREATE INDEX IF NOT EXISTS idx_installations_chitty_id
ON installations(chitty_id);

-- Index for account lookups
CREATE INDEX IF NOT EXISTS idx_installations_account
ON installations(account_id);

-- Index for account login
CREATE INDEX IF NOT EXISTS idx_installations_account_login
ON installations(account_login);

-- Index for active installations (not uninstalled)
CREATE INDEX IF NOT EXISTS idx_installations_active
ON installations(uninstalled_at)
WHERE uninstalled_at IS NULL;

-- Index for installation date
CREATE INDEX IF NOT EXISTS idx_installations_installed
ON installations(installed_at DESC);

-- Comments:
-- installation_id: GitHub's installation ID (unique integer)
-- chitty_id: ChittyID minted for this installation (format: CHITTY-CONTEXT-{uuid})
-- chitty_dna_id: ChittyID of DNA record tracking installation evolution
-- account_id: GitHub account ID (user or organization)
-- account_login: GitHub username or org name
-- account_type: 'User' or 'Organization'
-- account_avatar_url: URL to account avatar image
-- repository_selection: 'all' repositories or 'selected' subset
-- permissions: JSON object of granted permissions (e.g., {"contents":"read","issues":"write"})
-- events: JSON array of webhook events (e.g., ["push","pull_request","issues"])
-- selected_repositories: JSON array of selected repo names (if repository_selection='selected')
-- suspended_at: Timestamp when installation was suspended (NULL if active)
-- suspended_by_chitty_id: ChittyID of actor who suspended (admin action)
-- installed_at: When the app was installed
-- updated_at: Last modification timestamp
-- uninstalled_at: When the app was uninstalled (NULL if still installed)
