#!/usr/bin/env node
/**
 * Run Neon PostgreSQL migrations for ChittyConnect
 *
 * Usage:
 *   DATABASE_URL="postgres://..." node scripts/run-neon-migrations.js
 *
 * Or with op CLI:
 *   DATABASE_URL=$(op read "op://Infrastructure/Neon Database/credential") node scripts/run-neon-migrations.js
 */

import { Client } from '@neondatabase/serverless';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, '..', 'migrations');

// Migrations that target Neon PostgreSQL (not D1)
const NEON_MIGRATIONS = [
  '007_experience_anchor.sql',
  '008_experience_provenance.sql'
];

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    console.error('');
    console.error('Usage:');
    console.error('  DATABASE_URL="postgres://..." node scripts/run-neon-migrations.js');
    console.error('');
    console.error('Or with 1Password CLI:');
    console.error('  DATABASE_URL=$(op read "op://Infrastructure/Neon Database/credential") node scripts/run-neon-migrations.js');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });

  try {
    console.log('[Migrations] Connecting to Neon database...');
    await client.connect();
    console.log('[Migrations] Connected successfully');

    // Create migrations tracking table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[Migrations] Migrations tracking table ready');

    // Get already applied migrations
    const { rows: appliedMigrations } = await client.query(
      'SELECT name FROM _migrations ORDER BY applied_at'
    );
    const appliedSet = new Set(appliedMigrations.map(r => r.name));
    console.log(`[Migrations] Found ${appliedSet.size} previously applied migrations`);

    // Run pending migrations
    for (const migrationFile of NEON_MIGRATIONS) {
      if (appliedSet.has(migrationFile)) {
        console.log(`[Migrations] SKIP: ${migrationFile} (already applied)`);
        continue;
      }

      const migrationPath = join(migrationsDir, migrationFile);
      console.log(`[Migrations] APPLYING: ${migrationFile}`);

      try {
        const sql = readFileSync(migrationPath, 'utf-8');

        // Execute migration within a transaction
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO _migrations (name) VALUES ($1)',
          [migrationFile]
        );
        await client.query('COMMIT');

        console.log(`[Migrations] SUCCESS: ${migrationFile}`);
      } catch (error) {
        await client.query('ROLLBACK');
        console.error(`[Migrations] FAILED: ${migrationFile}`);
        console.error(`[Migrations] Error: ${error.message}`);
        throw error;
      }
    }

    console.log('[Migrations] All migrations completed successfully');

  } catch (error) {
    console.error('[Migrations] Migration failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('[Migrations] Connection closed');
  }
}

runMigrations();
