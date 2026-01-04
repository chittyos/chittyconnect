#!/usr/bin/env node
// Cloudflare inventory collector: lists Workers/compute resources for one account
// Usage (CI/local): CLOUDFLARE_API_TOKEN=... node scripts/cloudflare-inventory.js [--account <id>] [--out <file>]

import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const CF_API = 'https://api.cloudflare.com/client/v4';
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) {
  console.error('CLOUDFLARE_API_TOKEN is required');
  process.exit(1);
}

function arg(flag, def = undefined) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : def;
}

function readAccountId() {
  const fromArg = arg('--account');
  if (fromArg) return fromArg;
  try {
    const toml = readFileSync('wrangler.toml', 'utf8');
    const m = toml.match(/account_id\s*=\s*"([^"]+)"/);
    if (m) return m[1];
  } catch {}
  return process.env.CLOUDFLARE_ACCOUNT_ID || null;
}

async function cf(path) {
  const res = await fetch(`${CF_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    return { error: { status: res.status, body: text } };
  }
  return res.json();
}

async function main() {
  const accountId = readAccountId();
  if (!accountId) {
    console.error('Could not determine account_id (pass --account or set in wrangler.toml or env)');
    process.exit(1);
  }

  const outPath = arg('--out', 'docs/inventory/cloudflare-inventory.json');
  const result = { accountId, collectedAt: new Date().toISOString() };

  // Workers scripts
  result.workers = await cf(`/accounts/${accountId}/workers/scripts`);

  // KV namespaces
  result.kv = await cf(`/accounts/${accountId}/storage/kv/namespaces`);

  // Queues
  result.queues = await cf(`/accounts/${accountId}/queues/queues`);

  // D1 databases (try common endpoints)
  result.d1 = await cf(`/accounts/${accountId}/d1/database`);
  if (result.d1?.success === false || result.d1?.error) {
    result.d1_alt = await cf(`/accounts/${accountId}/d1/databases`);
  }

  // Vectorize indexes
  result.vectorize = await cf(`/accounts/${accountId}/ai/vectorize/indexes`);

  // Durable Objects overview is tied to scripts; bindings appear per script via Workers API.
  // Optionally fetch details per script (best-effort, skip if too many)
  try {
    if (Array.isArray(result.workers?.result)) {
      const limited = result.workers.result.slice(0, 20); // avoid API spam
      result.worker_details = [];
      for (const w of limited) {
        const name = w?.id || w?.name || w?.script; 
        if (!name) continue;
        const detail = await cf(`/accounts/${accountId}/workers/scripts/${encodeURIComponent(name)}`);
        result.worker_details.push({ name, detail });
      }
    }
  } catch (e) {
    result.worker_details_error = String(e);
  }

  // Write output
  mkdirSync('docs/inventory', { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`Wrote inventory to ${outPath}`);
}

// Node 18/20 global fetch is available
main().catch((e) => {
  console.error('Inventory collection failed:', e);
  process.exit(1);
});

