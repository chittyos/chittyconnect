/**
 * D1 Database Schema Initialization
 *
 * Tables:
 * - contexts: ChittyConnect service contexts
 * - installations: GitHub App installations
 */

/**
 * Initialize database schema
 * Creates tables and indexes if they don't exist
 */
export async function initializeSchema(db) {
  try {
    console.log('[DB] Initializing database schema...');

    // Create contexts table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS contexts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chitty_id TEXT UNIQUE NOT NULL,
        name TEXT UNIQUE NOT NULL,
        owner_id TEXT,
        dna_record TEXT,
        api_key_id TEXT,
        verified BOOLEAN DEFAULT 0,
        certified BOOLEAN DEFAULT 0,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    console.log('[DB] contexts table created/verified');

    // Create indexes for contexts table
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_contexts_chitty_id ON contexts(chitty_id)
    `);

    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_contexts_name ON contexts(name)
    `);

    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_contexts_owner_id ON contexts(owner_id)
    `);

    console.log('[DB] contexts table indexes created/verified');

    // Create installations table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS installations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        installation_id INTEGER UNIQUE NOT NULL,
        chitty_id TEXT NOT NULL,
        account_id INTEGER NOT NULL,
        account_login TEXT NOT NULL,
        account_type TEXT NOT NULL,
        repository_selection TEXT,
        permissions TEXT,
        events TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    console.log('[DB] installations table created/verified');

    // Create indexes for installations table
    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_installations_installation_id ON installations(installation_id)
    `);

    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_installations_chitty_id ON installations(chitty_id)
    `);

    await db.exec(`
      CREATE INDEX IF NOT EXISTS idx_installations_account_id ON installations(account_id)
    `);

    console.log('[DB] installations table indexes created/verified');

    console.log('[DB] Database schema initialization complete');
    return { success: true };

  } catch (error) {
    console.error('[DB] Schema initialization failed:', error.message);
    throw error;
  }
}

/**
 * Check if context exists
 */
export async function contextExists(db, name) {
  try {
    const result = await db.prepare(
      'SELECT chitty_id FROM contexts WHERE name = ?'
    ).bind(name).first();

    return result !== null;
  } catch (error) {
    console.error('[DB] Context existence check failed:', error.message);
    return false;
  }
}

/**
 * Get context by name
 */
export async function getContextByName(db, name) {
  try {
    const result = await db.prepare(
      'SELECT * FROM contexts WHERE name = ?'
    ).bind(name).first();

    if (result && result.metadata) {
      result.metadata = JSON.parse(result.metadata);
    }

    return result;
  } catch (error) {
    console.error('[DB] Get context by name failed:', error.message);
    return null;
  }
}

/**
 * Get context by ChittyID
 */
export async function getContextByChittyID(db, chittyId) {
  try {
    const result = await db.prepare(
      'SELECT * FROM contexts WHERE chitty_id = ?'
    ).bind(chittyId).first();

    if (result && result.metadata) {
      result.metadata = JSON.parse(result.metadata);
    }

    return result;
  } catch (error) {
    console.error('[DB] Get context by ChittyID failed:', error.message);
    return null;
  }
}

/**
 * Create context record
 */
export async function createContext(db, contextData) {
  try {
    const now = new Date().toISOString();

    await db.prepare(`
      INSERT INTO contexts (
        chitty_id, name, owner_id, dna_record, api_key_id,
        verified, certified, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      contextData.chittyId,
      contextData.name,
      contextData.ownerId || null,
      contextData.dnaRecord ? JSON.stringify(contextData.dnaRecord) : null,
      contextData.apiKeyId || null,
      contextData.verified ? 1 : 0,
      contextData.certified ? 1 : 0,
      contextData.metadata ? JSON.stringify(contextData.metadata) : null,
      now,
      now
    ).run();

    return { success: true, createdAt: now };
  } catch (error) {
    console.error('[DB] Create context failed:', error.message);
    throw error;
  }
}

/**
 * Update context record
 */
export async function updateContext(db, chittyId, updates) {
  try {
    const now = new Date().toISOString();
    const fields = [];
    const values = [];

    if (updates.verified !== undefined) {
      fields.push('verified = ?');
      values.push(updates.verified ? 1 : 0);
    }

    if (updates.certified !== undefined) {
      fields.push('certified = ?');
      values.push(updates.certified ? 1 : 0);
    }

    if (updates.dnaRecord !== undefined) {
      fields.push('dna_record = ?');
      values.push(JSON.stringify(updates.dnaRecord));
    }

    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }

    fields.push('updated_at = ?');
    values.push(now);

    values.push(chittyId);

    await db.prepare(`
      UPDATE contexts SET ${fields.join(', ')} WHERE chitty_id = ?
    `).bind(...values).run();

    return { success: true, updatedAt: now };
  } catch (error) {
    console.error('[DB] Update context failed:', error.message);
    throw error;
  }
}

/**
 * Create installation record
 */
export async function createInstallation(db, installationData) {
  try {
    const now = new Date().toISOString();

    await db.prepare(`
      INSERT INTO installations (
        installation_id, chitty_id, account_id, account_login, account_type,
        repository_selection, permissions, events, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      installationData.installationId,
      installationData.chittyId,
      installationData.accountId,
      installationData.accountLogin,
      installationData.accountType,
      installationData.repositorySelection || 'all',
      installationData.permissions ? JSON.stringify(installationData.permissions) : null,
      installationData.events ? JSON.stringify(installationData.events) : null,
      installationData.metadata ? JSON.stringify(installationData.metadata) : null,
      now,
      now
    ).run();

    return { success: true, createdAt: now };
  } catch (error) {
    console.error('[DB] Create installation failed:', error.message);
    throw error;
  }
}

/**
 * Get installation by ID
 */
export async function getInstallation(db, installationId) {
  try {
    const result = await db.prepare(
      'SELECT * FROM installations WHERE installation_id = ?'
    ).bind(installationId).first();

    if (result) {
      if (result.permissions) result.permissions = JSON.parse(result.permissions);
      if (result.events) result.events = JSON.parse(result.events);
      if (result.metadata) result.metadata = JSON.parse(result.metadata);
    }

    return result;
  } catch (error) {
    console.error('[DB] Get installation failed:', error.message);
    return null;
  }
}

/**
 * Get all installations for an account
 */
export async function getInstallationsByAccount(db, accountId) {
  try {
    const results = await db.prepare(
      'SELECT * FROM installations WHERE account_id = ?'
    ).bind(accountId).all();

    return results.results || [];
  } catch (error) {
    console.error('[DB] Get installations by account failed:', error.message);
    return [];
  }
}

/**
 * Update installation record
 */
export async function updateInstallation(db, installationId, updates) {
  try {
    const now = new Date().toISOString();
    const fields = [];
    const values = [];

    if (updates.repositorySelection !== undefined) {
      fields.push('repository_selection = ?');
      values.push(updates.repositorySelection);
    }

    if (updates.permissions !== undefined) {
      fields.push('permissions = ?');
      values.push(JSON.stringify(updates.permissions));
    }

    if (updates.events !== undefined) {
      fields.push('events = ?');
      values.push(JSON.stringify(updates.events));
    }

    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }

    fields.push('updated_at = ?');
    values.push(now);

    values.push(installationId);

    await db.prepare(`
      UPDATE installations SET ${fields.join(', ')} WHERE installation_id = ?
    `).bind(...values).run();

    return { success: true, updatedAt: now };
  } catch (error) {
    console.error('[DB] Update installation failed:', error.message);
    throw error;
  }
}

/**
 * Delete installation record
 */
export async function deleteInstallation(db, installationId) {
  try {
    await db.prepare(
      'DELETE FROM installations WHERE installation_id = ?'
    ).bind(installationId).run();

    return { success: true };
  } catch (error) {
    console.error('[DB] Delete installation failed:', error.message);
    throw error;
  }
}
