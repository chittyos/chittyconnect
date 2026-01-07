#!/usr/bin/env node
// Preview which registry entries should be created for a validated entity
// Usage: node scripts/plan-auto-registry.js --entity authority/services/foo.json

import { readFileSync } from 'fs';

function arg(flag, def = undefined) { const i = process.argv.indexOf(flag); return i>-1 ? process.argv[i+1] : def; }
function load(p){ return JSON.parse(readFileSync(p,'utf8')); }

function matchWhen(when, entity){
  if (!when) return true;
  if (when.always === true) return true;
  if (when.statusIn && !when.statusIn.includes(entity.status)) return false;
  for (const [k,v] of Object.entries(when)){
    if (k==='statusIn' || k==='always') continue;
    const val = entity[k];
    if (v==='*') { if (val===undefined||val===null||val==='') return false; }
    else if (val!==v) return false;
  }
  return true;
}

try {
  const file = arg('--entity');
  if (!file) { console.error('Missing --entity <path>'); process.exit(2); }
  const entity = load(file);
  const auto = load('etc/authority/auto-registry.json');
  const notion = load('etc/registries/notion.json');

  const type = entity.entity_type || 'Service';
  const plan = { entity: entity.service_name || entity.evidence_id || 'unknown', entity_type: type, actions: [] };
  const conf = auto[type];
  if (!conf) { console.log(JSON.stringify(plan,null,2)); process.exit(0); }

  for (const p of (conf.primary||[])){
    plan.actions.push({ create: p, target: notionFor(p, notion) });
  }
  for (const rel of (conf.related||[])){
    if (matchWhen(rel.when, entity)){
      for (const out of rel.create) plan.actions.push({ create: out, target: notionFor(out, notion) });
    }
  }
  console.log(JSON.stringify(plan,null,2));
} catch (e) {
  console.error('Plan failed:', e.message);
  process.exit(1);
}

function notionFor(kind, notion){
  switch(kind){
    case 'ServiceRegistry': return notion.service_registry_db_id;
    case 'DomainRegistry': return notion.domain_registry_db_id;
    case 'InfrastructureRegistry': return notion.infra_registry_db_id;
    case 'VersionControlRegistry': return notion.version_control_registry_db_id;
    case 'LegalRegistryLink': return notion.legal_registry_db_id;
    case 'EvidenceIndex': return notion.evidence_index_db_id;
    case 'CaseRegistryLink': return notion.case_registry_db_id;
    case 'LedgerRecord': return 'ledger-dataset';
    case 'ChainProvenance': return 'chain-endpoint';
    default: return null;
  }
}

