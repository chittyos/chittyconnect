#!/usr/bin/env node
// extract-declared-bindings.mjs — emit (one per line) all binding NAMES
// declared in wrangler.jsonc for a given env. Combines top-level inheritable
// bindings (secrets_store_secrets) with the named env block's bindings.
//
// Usage:  node scripts/lib/extract-declared-bindings.mjs <env>
// Reads:  wrangler.jsonc at repo root
// Output: one binding name per line, sorted+uniq, on stdout.
//
// Implementation note: wrangler.jsonc allows // line comments and /* */ block
// comments, but ALSO has // inside string literals (URLs). Naive sed strips
// break that. We use a tiny tokenizer-aware strip: walk char-by-char, track
// whether we're inside a string, and only strip // / /* outside strings.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const cfgPath = resolve(repoRoot, 'wrangler.jsonc');

const envName = process.argv[2];
if (!envName) {
  console.error('usage: extract-declared-bindings.mjs <env>');
  process.exit(64);
}

function stripJsonc(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let inStr = false;
  let strQuote = '';
  while (i < n) {
    const c = src[i];
    const nx = src[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\' && i + 1 < n) { out += nx; i += 2; continue; }
      if (c === strQuote) { inStr = false; }
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; strQuote = c; out += c; i += 1; continue; }
    if (c === '/' && nx === '/') {
      // line comment: skip to newline
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && nx === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  // Also drop trailing commas (legal in JSONC, illegal in JSON)
  return out.replace(/,(\s*[}\]])/g, '$1');
}

const raw = readFileSync(cfgPath, 'utf8');
const json = JSON.parse(stripJsonc(raw));

function namesFrom(obj) {
  if (!obj || typeof obj !== 'object') return [];
  const out = [];
  // Secret stores
  for (const item of obj.secrets_store_secrets || []) if (item?.binding) out.push(item.binding);
  // KV namespaces
  for (const item of obj.kv_namespaces        || []) if (item?.binding) out.push(item.binding);
  // D1 databases
  for (const item of obj.d1_databases         || []) if (item?.binding) out.push(item.binding);
  // R2 buckets
  for (const item of obj.r2_buckets           || []) if (item?.binding) out.push(item.binding);
  // Vectorize indexes (https://developers.cloudflare.com/vectorize/reference/client-api/)
  for (const item of obj.vectorize            || []) if (item?.binding) out.push(item.binding);
  // Service bindings (https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
  for (const item of obj.services             || []) if (item?.binding) out.push(item.binding);
  // Hyperdrive
  for (const item of obj.hyperdrive           || []) if (item?.binding) out.push(item.binding);
  // Analytics Engine
  for (const item of obj.analytics_engine_datasets || []) if (item?.binding) out.push(item.binding);
  // AI Search namespace bindings (https://developers.cloudflare.com/ai-search/api/migration/workers-binding/)
  // Changelog: https://developers.cloudflare.com/changelog/post/2026-04-16-ai-search-namespace-binding/
  for (const item of obj.ai_search_namespaces || []) if (item?.binding) out.push(item.binding);
  // Browser rendering
  if (obj.browser?.binding) out.push(obj.browser.binding);
  // Workers AI
  if (obj.ai?.binding) out.push(obj.ai.binding);
  // Queue producers
  if (obj.queues?.producers) for (const p of obj.queues.producers) if (p?.binding) out.push(p.binding);
  // queues.consumers are invocation handlers, NOT bindings — do not include.
  // Durable Objects
  if (obj.durable_objects?.bindings) for (const d of obj.durable_objects.bindings) if (d?.name) out.push(d.name);
  // Plain vars
  if (obj.vars && typeof obj.vars === 'object') for (const k of Object.keys(obj.vars)) out.push(k);
  return out;
}

const top = namesFrom(json);
const envObj = (json.env && json.env[envName]) || {};
const envBindings = namesFrom(envObj);
const all = [...new Set([...top, ...envBindings])].filter(Boolean).sort();
for (const n of all) process.stdout.write(n + '\n');
