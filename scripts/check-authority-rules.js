#!/usr/bin/env node
// Validate service entries against simple conditional rules (etc/authority/rules.json)

import { readFileSync, readdirSync, existsSync } from 'fs';
import path from 'path';

function get(obj, key) {
  return key.split('.').reduce((o, k) => (o && k in o ? o[k] : undefined), obj);
}

function matchCondition(obj, cond) {
  if (cond.always === true) return true;
  for (const [k, v] of Object.entries(cond)) {
    const val = get(obj, k);
    if (val !== v) return false;
  }
  return true;
}

function checkRequired(obj, fields, errs, msg) {
  for (const f of fields) {
    if (get(obj, f) === undefined || get(obj, f) === null || get(obj, f) === '') {
      errs.push(`${msg}: missing ${f}`);
    }
  }
}

function checkPattern(obj, patterns, errs, msg) {
  for (const [k, pat] of Object.entries(patterns)) {
    const val = get(obj, k);
    if (val === undefined) continue;
    const re = new RegExp(pat);
    if (!re.test(val)) errs.push(`${msg}: ${k} does not match ${pat} (got ${val})`);
  }
}

try {
  // Load optional config for fallbacks
  let cfg = {};
  if (existsSync('etc/authority/config.json')) {
    cfg = JSON.parse(readFileSync('etc/authority/config.json', 'utf8'));
  }
  let rules = JSON.parse(readFileSync('etc/authority/rules.json', 'utf8')).rules || [];
  // Merge profile-specific rules if configured
  try {
    const prof = JSON.parse(readFileSync('etc/profiles/profile.json', 'utf8')).active;
    if (prof) {
      const pr = JSON.parse(readFileSync(`etc/profiles/${prof}/rules.json`, 'utf8')).rules || [];
      rules = rules.concat(pr);
      console.log(`Loaded profile rules for: ${prof}`);
    }
  } catch {}
  const dir = 'authority/services';
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  let failed = false;
  for (const f of files) {
    const p = path.join(dir, f);
    const obj = JSON.parse(readFileSync(p, 'utf8'));
    const errs = [];
    for (const r of rules) {
      if (matchCondition(obj, r.if || {})) {
        if (r.then?.required) {
          for (const f of r.then.required) {
            const val = get(obj, f);
            if (val === undefined || val === null || val === '') {
              // Fallback for owner_entity using config
              if (f === 'owner_entity' && cfg.default_owner_entity) {
                console.log(`INFO: ${p} missing owner_entity; defaulting to ${cfg.default_owner_entity}`);
                continue;
              }
              // Fallback for OpenAPI docs via local file
              if (f === 'routes.docs' && existsSync('public/openapi.json')) {
                console.log(`INFO: ${p} missing routes.docs; local public/openapi.json present`);
                continue;
              }
              errs.push(`${r.message || 'Rule failed'}: missing ${f}`);
            }
          }
        }
        if (r.then?.pattern) checkPattern(obj, r.then.pattern, errs, r.message || 'Rule failed');
      }
    }
    if (errs.length) {
      failed = true;
      console.error(`Rules failed for ${f}:`);
      for (const e of errs) console.error('  -', e);
    } else {
      console.log(`OK: ${f}`);
    }
  }
  process.exit(failed ? 2 : 0);
} catch (e) {
  console.error('Authority rules check failed:', e.message);
  process.exit(1);
}
