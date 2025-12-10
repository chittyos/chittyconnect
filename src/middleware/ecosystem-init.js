/**
 * ChittyOS Ecosystem Initialization Middleware
 *
 * Automatically initializes ChittyConnect on first request:
 * - Database schema creation (blocking)
 * - ChittyOS ecosystem registration (non-blocking)
 *
 * Design:
 * - One-time initialization per deployment
 * - Graceful degradation on ChittyOS service failures
 * - Database init is blocking (critical for operation)
 * - Ecosystem init is async (non-critical, best-effort)
 */

import { createEcosystem } from '../integrations/chittyos-ecosystem.js';
import { allMigrations } from '../db/migrations.js';

/**
 * Check if database is initialized
 */
async function isDatabaseInitialized(db) {
  try {
    // Check if contexts table exists
    const result = await db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='contexts'"
    ).first();

    return result !== null;
  } catch (error) {
    return false;
  }
}

/**
 * Initialize database schema
 * BLOCKING: This must succeed for the service to function
 */
async function initializeDatabase(db) {
  console.log('[DB] Initializing database schema...');

  try {
    // Run migrations in order
    for (const migration of allMigrations) {
      console.log(`[DB] Running migration: ${migration.name}`);
      await db.exec(migration.sql);
    }

    console.log('[DB] Database schema initialized successfully');
    return { success: true };

  } catch (error) {
    console.error('[DB] Database initialization failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Check if ChittyConnect context exists
 */
async function getExistingContext(db) {
  try {
    const result = await db.prepare(
      "SELECT * FROM contexts WHERE name = ? AND status = 'active' LIMIT 1"
    ).bind('chittyconnect').first();

    return result;
  } catch (error) {
    console.error('[Context] Failed to query existing context:', error.message);
    return null;
  }
}

/**
 * Store context in database
 */
async function storeContext(db, contextData) {
  try {
    await db.prepare(`
      INSERT INTO contexts (
        chitty_id,
        name,
        owner_chitty_id,
        data,
        systems,
        tools,
        chitty_dna_id,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      contextData.chittyId,
      contextData.name,
      contextData.owner || 'CHITTY-SYS-CHITTYCONNECT',
      JSON.stringify(contextData.data || []),
      JSON.stringify(contextData.systems || []),
      JSON.stringify(contextData.tools || []),
      contextData.dnaId || null,
      'active',
      new Date().toISOString(),
      new Date().toISOString()
    ).run();

    return { success: true };
  } catch (error) {
    console.error('[Context] Failed to store context:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Initialize ChittyConnect context with ChittyOS ecosystem
 * NON-BLOCKING: Failures are logged but don't prevent service from starting
 */
async function initializeEcosystemContext(env, ctx, db) {
  console.log('[Ecosystem] Initializing ChittyConnect context...');

  // Check if we already have a context
  const existingContext = await getExistingContext(db);
  if (existingContext) {
    console.log(`[Ecosystem] Context already exists: ${existingContext.chitty_id}`);
    return {
      success: true,
      existing: true,
      chittyId: existingContext.chitty_id,
    };
  }

  // Create ecosystem manager
  const ecosystem = createEcosystem(env, ctx);

  // Initialize service context (non-blocking, best-effort)
  const initResult = await ecosystem.initializeServiceContext('chittyconnect', {
    version: env.SERVICE_VERSION || '1.0.0',
    capabilities: ['mcp', 'rest-api', 'github-app'],
    description: 'ChittyConnect - The AI-intelligent spine with ContextConsciousness™',
  });

  if (initResult.success) {
    // Store in database
    const storeResult = await storeContext(db, {
      chittyId: initResult.chittyId,
      name: 'chittyconnect',
      owner: 'CHITTY-SYS-CHITTYCONNECT',
      data: [],
      systems: ['chittyid', 'chittyauth', 'chittyregistry', 'chittydna', 'chittychronicle'],
      tools: [],
      dnaId: initResult.steps.dna?.dna_id,
    });

    if (storeResult.success) {
      console.log('[Ecosystem] ChittyConnect context initialized and stored');
    } else {
      console.warn('[Ecosystem] Context initialized but storage failed:', storeResult.error);
    }
  } else {
    console.warn('[Ecosystem] Context initialization incomplete:', initResult.error);
    // Service can still operate without full ecosystem integration
  }

  return initResult;
}

/**
 * Ecosystem Initialization Middleware
 *
 * Runs on every request but only initializes once
 * Uses in-memory flag to track initialization state
 */
let isInitialized = false;
let initializationPromise = null;

export async function ecosystemInitMiddleware(request, env, ctx) {
  // Fast path: already initialized
  if (isInitialized) {
    return null; // Continue to next handler
  }

  // If initialization is in progress, wait for it
  if (initializationPromise) {
    await initializationPromise;
    return null;
  }

  // Start initialization
  initializationPromise = (async () => {
    try {
      console.log('[Init] Starting ChittyConnect initialization...');

      // Step 1: Initialize database (BLOCKING)
      if (env.DB) {
        const dbInitialized = await isDatabaseInitialized(env.DB);

        if (!dbInitialized) {
          const dbResult = await initializeDatabase(env.DB);
          if (!dbResult.success) {
            throw new Error(`Database initialization failed: ${dbResult.error}`);
          }
        } else {
          console.log('[DB] Database already initialized');
        }
      } else {
        console.warn('[DB] No D1 database binding found, skipping database init');
      }

      // Step 2: Initialize ChittyOS ecosystem context (NON-BLOCKING)
      // Run in background, don't block request
      if (env.DB) {
        ctx.waitUntil(
          initializeEcosystemContext(env, ctx, env.DB).catch(error => {
            console.error('[Ecosystem] Background initialization failed:', error);
          })
        );
      }

      isInitialized = true;
      console.log('[Init] ChittyConnect initialization complete');

    } catch (error) {
      console.error('[Init] Initialization failed:', error.message);
      // Don't set isInitialized to allow retry on next request
      throw error;
    }
  })();

  await initializationPromise;
  initializationPromise = null;

  return null; // Continue to next handler
}

/**
 * Get initialization status
 */
export function getInitializationStatus() {
  return {
    initialized: isInitialized,
    in_progress: initializationPromise !== null,
  };
}

/**
 * Force reinitialization (for testing or manual trigger)
 */
export function resetInitialization() {
  isInitialized = false;
  initializationPromise = null;
}
