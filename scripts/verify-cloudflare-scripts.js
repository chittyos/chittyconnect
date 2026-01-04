#!/usr/bin/env node
// Verify expected Cloudflare Worker script names exist in inventory output
// Usage: node scripts/verify-cloudflare-scripts.js --inv cloudflare-inventory.json [--wrangler wrangler.toml]

import { readFileSync } from 'fs';

function arg(flag, def = undefined) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : def;
}

function expectedFromWrangler(toml) {
  const names = new Set();
  const nameMatches = [...toml.matchAll(/\nname\s*=\s*"([^"]+)"/g)];
  for (const m of nameMatches) names.add(m[1]);
  return Array.from(names);
}

function workerNamesFromInventory(inv) {
  const arr = [];
  const list = Array.isArray(inv?.workers?.result) ? inv.workers.result : [];
  for (const w of list) {
    const name = w?.id || w?.name || w?.script;
    if (name) arr.push(name);
  }
  return arr;
}

try {
  const invPath = arg('--inv', 'cloudflare-inventory.json');
  const inv = JSON.parse(readFileSync(invPath, 'utf8'));
  const wranglerPath = arg('--wrangler', 'wrangler.toml');
  const toml = readFileSync(wranglerPath, 'utf8');

  const expected = expectedFromWrangler(toml);
  const present = workerNamesFromInventory(inv);

  const missing = expected.filter((e) => !present.includes(e));
  console.log('Expected:', expected);
  console.log('Present:', present);
  if (missing.length) {
    console.log('Missing scripts:', missing);
    process.exitCode = 2;
  } else {
    console.log('All expected scripts are present.');
  }
} catch (e) {
  console.error('Verification failed:', e.message);
  process.exit(1);
}

