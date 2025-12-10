#!/usr/bin/env node

/**
 * Update OpenAPI Spec - Add Chronicle and Quality endpoints
 *
 * Merges the new Chronicle and Quality API definitions into the existing
 * ChittyConnect OpenAPI specification.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPENAPI_PATH = path.join(__dirname, '../public/openapi.json');
const PATHS_PATH = path.join(__dirname, '../chronicle-quality-openapi-paths.json');
const SCHEMAS_PATH = path.join(__dirname, '../chronicle-quality-openapi-schemas.json');

async function updateOpenAPI() {
  console.log('[OpenAPI] Loading existing specification...');

  // Load existing OpenAPI spec
  const openapiContent = await fs.readFile(OPENAPI_PATH, 'utf-8');
  const openapi = JSON.parse(openapiContent);

  // Load new paths and schemas
  const newPaths = JSON.parse(await fs.readFile(PATHS_PATH, 'utf-8'));
  const newSchemas = JSON.parse(await fs.readFile(SCHEMAS_PATH, 'utf-8'));

  console.log('[OpenAPI] Removing old Chronicle endpoints...');

  // Remove old Chronicle endpoints (log and query)
  delete openapi.paths['/api/chittychronicle/log'];
  delete openapi.paths['/api/chittychronicle/query'];

  console.log('[OpenAPI] Adding new Chronicle and Quality endpoints...');

  // Add new paths
  Object.assign(openapi.paths, newPaths);

  console.log('[OpenAPI] Adding new schemas...');

  // Add new schemas
  if (!openapi.components) {
    openapi.components = {};
  }
  if (!openapi.components.schemas) {
    openapi.components.schemas = {};
  }
  Object.assign(openapi.components.schemas, newSchemas);

  console.log('[OpenAPI] Adding tags...');

  // Add tags if they don't exist
  if (!openapi.tags) {
    openapi.tags = [];
  }

  const chronicleTag = { name: 'Chronicle', description: 'Event logging and audit trail endpoints' };
  const qualityTag = { name: 'Quality', description: 'Document quality validation endpoints' };

  // Only add if not already present
  if (!openapi.tags.find(t => t.name === 'Chronicle')) {
    openapi.tags.push(chronicleTag);
  }
  if (!openapi.tags.find(t => t.name === 'Quality')) {
    openapi.tags.push(qualityTag);
  }

  console.log('[OpenAPI] Sorting paths...');

  // Sort paths alphabetically
  const sortedPaths = {};
  Object.keys(openapi.paths).sort().forEach(key => {
    sortedPaths[key] = openapi.paths[key];
  });
  openapi.paths = sortedPaths;

  console.log('[OpenAPI] Writing updated specification...');

  // Write updated spec with pretty formatting
  await fs.writeFile(
    OPENAPI_PATH,
    JSON.stringify(openapi, null, 2) + '\n',
    'utf-8'
  );

  console.log('[OpenAPI] ✓ Successfully updated OpenAPI specification!');
  console.log(`[OpenAPI]   - Added Chronicle endpoints: /api/chittychronicle/*`);
  console.log(`[OpenAPI]   - Added Quality endpoints: /api/chittyquality/*`);
  console.log(`[OpenAPI]   - Added ${Object.keys(newSchemas).length} new schemas`);
  console.log(`[OpenAPI]   - Total paths: ${Object.keys(openapi.paths).length}`);
  console.log(`[OpenAPI]   - Total schemas: ${Object.keys(openapi.components.schemas).length}`);
}

// Run the update
updateOpenAPI().catch(error => {
  console.error('[OpenAPI] Error updating specification:', error);
  process.exit(1);
});
