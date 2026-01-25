#!/usr/bin/env node
/**
 * Bootstrap Service Tokens for ChittyConnect
 *
 * This script generates valid service tokens for ChittyConnect to use
 * when calling other ChittyOS services. It uses the same JWT format
 * as ChittyAuth's token service.
 *
 * Usage:
 *   1. Set JWT_SECRET environment variable (or it will prompt)
 *   2. Run: node scripts/bootstrap-service-tokens.mjs
 *   3. Tokens are generated and can be set via wrangler secret put
 *
 * Security:
 *   - Tokens are signed with ChittyAuth's JWT_SECRET
 *   - Long expiration (1 year) for service-to-service use
 *   - Should be rotated annually
 */

import * as crypto from 'crypto';
import { execSync } from 'child_process';
import * as readline from 'readline';

// Service token configurations
const SERVICE_TOKENS = [
  {
    name: 'CHITTY_ID_TOKEN',
    services: ['chittyid'],
    scopes: ['chittyid:read', 'chittyid:write'],
    description: 'ChittyConnect → ChittyID service token'
  },
  {
    name: 'CHITTY_AUTH_TOKEN',
    services: ['chittyauth'],
    scopes: ['chittyauth:read', 'chittyauth:write'],
    description: 'ChittyConnect → ChittyAuth service token'
  },
  {
    name: 'CHITTY_CHRONICLE_TOKEN',
    services: ['chittychronicle'],
    scopes: ['chittychronicle:read', 'chittychronicle:write'],
    description: 'ChittyConnect → ChittyChronicle service token'
  },
  {
    name: 'CHITTY_REGISTRY_TOKEN',
    services: ['chittyregistry'],
    scopes: ['chittyregistry:read', 'chittyregistry:write'],
    description: 'ChittyConnect → ChittyRegistry service token'
  },
  {
    name: 'CHITTY_DNA_TOKEN',
    services: ['chittydna'],
    scopes: ['chittydna:read', 'chittydna:write'],
    description: 'ChittyConnect → ChittyDNA service token'
  },
  {
    name: 'CHITTY_VERIFY_TOKEN',
    services: ['chittyverify'],
    scopes: ['chittyverify:read', 'chittyverify:write'],
    description: 'ChittyConnect → ChittyVerify service token'
  },
  {
    name: 'CHITTY_CERTIFY_TOKEN',
    services: ['chittycertify'],
    scopes: ['chittycertify:read', 'chittycertify:write'],
    description: 'ChittyConnect → ChittyCertify service token'
  }
];

/**
 * Generate a JWT token using the same format as ChittyAuth
 */
function generateToken(jwtSecret, config) {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };

  const now = Math.floor(Date.now() / 1000);
  const oneYear = 365 * 24 * 60 * 60;

  const payload = {
    iss: 'auth.chitty.cc',
    sub: 'chittyconnect-service',
    aud: config.services,
    scopes: config.scopes,
    iat: now,
    exp: now + oneYear,
    jti: crypto.randomUUID(),
    type: 'service',
    name: config.name
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

  const signature = crypto
    .createHmac('sha256', jwtSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('hex');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

/**
 * Hash a token (same as ChittyAuth for DB storage)
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Prompt for input
 */
async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Main execution
 */
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║     ChittyConnect Service Token Bootstrap                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();

  // Get JWT_SECRET
  let jwtSecret = process.env.JWT_SECRET;

  if (!jwtSecret) {
    console.log('JWT_SECRET not found in environment.');
    console.log('You can get it from ChittyAuth Cloudflare secrets or 1Password.');
    console.log();
    jwtSecret = await prompt('Enter JWT_SECRET: ');
  }

  if (!jwtSecret || jwtSecret.length < 32) {
    console.error('Error: JWT_SECRET must be at least 32 characters');
    process.exit(1);
  }

  console.log();
  console.log('Generating service tokens...');
  console.log();

  const tokens = [];
  const sqlInserts = [];

  for (const config of SERVICE_TOKENS) {
    const token = generateToken(jwtSecret, config);
    const hash = hashToken(token);

    tokens.push({
      name: config.name,
      description: config.description,
      token: token,
      hash: hash
    });

    // Generate SQL for inserting into api_tokens table
    const now = new Date().toISOString();
    const expiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

    sqlInserts.push(`
INSERT INTO api_tokens (id, token_hash, name, scopes, status, expires_at, created_at, type)
VALUES (
  '${crypto.randomUUID()}',
  '${hash}',
  '${config.description}',
  ARRAY[${config.scopes.map(s => `'${s}'`).join(', ')}],
  'active',
  '${expiry}'::timestamptz,
  '${now}'::timestamptz,
  'bearer'
);`);

    console.log(`✓ Generated ${config.name}`);
    console.log(`  Services: ${config.services.join(', ')}`);
    console.log(`  Scopes: ${config.scopes.join(', ')}`);
    console.log();
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log();
  console.log('NEXT STEPS:');
  console.log();
  console.log('1. Set tokens as Cloudflare secrets:');
  console.log();

  for (const t of tokens) {
    console.log(`   echo "${t.token}" | wrangler secret put ${t.name} --env production`);
  }

  console.log();
  console.log('2. Insert token records into ChittyOS-Core database:');
  console.log();
  console.log('   Run these SQL statements in the Neon console or via MCP:');
  console.log();

  for (const sql of sqlInserts) {
    console.log(sql);
  }

  console.log();
  console.log('═══════════════════════════════════════════════════════════════');
  console.log();
  console.log('SECURITY NOTES:');
  console.log('- These tokens expire in 1 year');
  console.log('- Rotate before expiration');
  console.log('- Do NOT commit tokens to git');
  console.log('- Store JWT_SECRET securely in 1Password');
  console.log();

  // Option to save to file
  const save = await prompt('Save tokens to temporary file? (y/N): ');

  if (save.toLowerCase() === 'y') {
    const output = {
      generated: new Date().toISOString(),
      tokens: tokens.map(t => ({
        name: t.name,
        description: t.description,
        token: t.token,
        hash: t.hash
      })),
      sqlInserts: sqlInserts.join('\n')
    };

    const fs = await import('fs');
    const filename = `/tmp/chittyconnect-tokens-${Date.now()}.json`;
    fs.writeFileSync(filename, JSON.stringify(output, null, 2));
    console.log(`\nSaved to: ${filename}`);
    console.log('⚠️  DELETE THIS FILE after use!');
  }

  console.log();
  console.log('Done!');
}

main().catch(console.error);
