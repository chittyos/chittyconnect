#!/usr/bin/env node
// Validate a proposed change against etc/sync/policy.json
// Usage: node scripts/validate-mutation.js --change change.json [--policy etc/sync/policy.json]

import { readFileSync } from 'fs';

function arg(flag, def = undefined) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : def;
}

function loadJSON(p) { return JSON.parse(readFileSync(p, 'utf8')); }

function matches(ruleMatch, change) {
  for (const [k, v] of Object.entries(ruleMatch || {})) {
    if (change[k] !== v) return false;
  }
  return true;
}

try {
  const changePath = arg('--change');
  if (!changePath) { console.error('Missing --change <file>'); process.exit(2); }
  const policyPath = arg('--policy', 'etc/sync/policy.json');
  const change = loadJSON(changePath);
  const policy = loadJSON(policyPath);

  const rules = policy.rules || [];
  const denials = [];

  // Evaluate rules
  for (const r of rules) {
    if (!matches(r.match, change)) continue;
    if (r.immutable) {
      denials.push({ reason: r.reason || 'Immutable field', rule: r });
      continue;
    }
    if (r.operations && r.operations.includes(change.operation) && r.disallow_sources) {
      if (r.disallow_sources.includes(change.source)) {
        denials.push({ reason: r.reason || 'Operation disallowed from source', rule: r });
        continue;
      }
    }
    if (r.disallow_sources && r.disallow_sources.includes(change.source)) {
      denials.push({ reason: r.reason || 'Disallowed source', rule: r });
      continue;
    }
    if (r.allow && !r.allow.includes(change.source)) {
      denials.push({ reason: r.reason || 'Source not allowed', rule: r });
      continue;
    }
    if (r.requires_labels) {
      const labels = change.labels || [];
      for (const l of r.requires_labels) {
        if (!labels.includes(l)) {
          denials.push({ reason: `Missing required label: ${l}`, rule: r });
          break;
        }
      }
    }
  }

  if (denials.length) {
    console.error('DENIED:', JSON.stringify(denials, null, 2));
    process.exit(3);
  }

  // Defaults
  if (policy.defaults?.delete === false && change.operation === 'delete') {
    console.error('DENIED: Deletions disabled by default');
    process.exit(4);
  }
  if (policy.defaults?.allow === false) {
    console.error('DENIED: Default deny (no matching allow rule)');
    process.exit(5);
  }

  console.log('ALLOWED');
} catch (e) {
  console.error('Validation failed:', e.message);
  process.exit(1);
}

