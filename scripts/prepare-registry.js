#!/usr/bin/env node
// Prepare a registry JSON from Cloudflare inventory for onboarding/authority
// Usage: node scripts/prepare-registry.js [--in cloudflare-inventory.json] [--out docs/inventory/registry.json]

import { readFileSync, writeFileSync, mkdirSync } from 'fs';

function arg(flag, def = undefined) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : def;
}

function simplify(inv) {
  const out = { accountId: inv.accountId, generatedAt: new Date().toISOString(), services: [] };
  const workers = Array.isArray(inv?.workers?.result) ? inv.workers.result : [];
  for (const w of workers) {
    const name = w?.id || w?.name || w?.script || 'unknown';
    out.services.push({
      type: 'worker',
      name,
      modified_on: w?.modified_on,
      created_on: w?.created_on,
    });
  }
  const kv = Array.isArray(inv?.kv?.result) ? inv.kv.result : [];
  for (const ns of kv) {
    out.services.push({ type: 'kv', id: ns?.id, title: ns?.title });
  }
  const queues = Array.isArray(inv?.queues?.result) ? inv.queues.result : [];
  for (const q of queues) {
    out.services.push({ type: 'queue', name: q?.queue_name || q?.name, id: q?.id });
  }
  const d1 = Array.isArray(inv?.d1?.result) ? inv.d1.result : (Array.isArray(inv?.d1_alt?.result) ? inv.d1_alt.result : []);
  for (const db of d1) {
    out.services.push({ type: 'd1', id: db?.uuid || db?.id, name: db?.name });
  }
  const vec = Array.isArray(inv?.vectorize?.result) ? inv.vectorize.result : [];
  for (const ix of vec) {
    out.services.push({ type: 'vectorize', index_name: ix?.index_name || ix?.name, id: ix?.id });
  }
  return out;
}

try {
  const inPath = arg('--in', 'cloudflare-inventory.json');
  const outPath = arg('--out', 'docs/inventory/registry.json');
  const raw = readFileSync(inPath, 'utf8');
  const inv = JSON.parse(raw);
  const reg = simplify(inv);
  mkdirSync('docs/inventory', { recursive: true });
  writeFileSync(outPath, JSON.stringify(reg, null, 2));
  console.log(`Wrote registry file to ${outPath}`);
} catch (e) {
  console.error('Prepare registry failed:', e.message);
  process.exit(1);
}

