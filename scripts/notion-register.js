#!/usr/bin/env node
// Notion auto-register creator (dry-run by default)
// Usage:
//   node scripts/notion-register.js --entity authority/services/chittyconnect.json [--apply]
// Env:
//   NOTION_API_TOKEN

import { readFileSync } from 'fs';

function arg(flag, def = undefined) { const i = process.argv.indexOf(flag); return i>-1 ? process.argv[i+1] : def; }
function has(flag) { return process.argv.includes(flag); }
function load(p){ return JSON.parse(readFileSync(p,'utf8')); }

async function notionCreatePage(dbId, title, props = {}){
  const token = process.env.NOTION_API_TOKEN;
  if (!token) throw new Error('NOTION_API_TOKEN is required');
  const url = 'https://api.notion.com/v1/pages';
  const body = {
    parent: { database_id: dbId },
    properties: {
      Name: { title: [{ type: 'text', text: { content: title } }] },
      ...props,
    },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Notion API error ${res.status}: ${text}`);
  }
  return res.json();
}

function planForEntity(entity, auto, notion){
  const type = entity.entity_type || 'Service';
  const plan = { entity: entity.service_name || entity.evidence_id || 'unknown', entity_type: type, actions: [] };
  const conf = auto[type];
  if (!conf) return plan;
  const title = entity.service_name || entity.evidence_id || 'unknown';
  const push = (kind, target) => plan.actions.push({ create: kind, target, title });
  for (const p of (conf.primary||[])) push(p, notionFor(p, notion));
  for (const rel of (conf.related||[])){
    if (matchWhen(rel.when, entity)) for (const out of rel.create) push(out, notionFor(out, notion));
  }
  return plan;
}

function matchWhen(when, entity){
  if (!when) return true; if (when.always===true) return true;
  if (when.statusIn && !when.statusIn.includes(entity.status)) return false;
  for (const [k,v] of Object.entries(when)){
    if (k==='statusIn' || k==='always') continue;
    const val = entity[k];
    if (v==='*') { if (val===undefined||val===null||val==='') return false; }
    else if (val!==v) return false;
  }
  return true;
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
    default: return null;
  }
}

function propertiesFor(createKind, entity){
  // Minimal property set to reduce schema mismatch risk
  const json = JSON.stringify(entity);
  const common = {
    JSON: { rich_text: [{ type: 'text', text: { content: json.slice(0, 1900) } }] },
  };
  switch(createKind){
    case 'ServiceRegistry':
      return { ...common, service_name: { rich_text: [{ text: { content: entity.service_name||'' } }] }, status: { select: { name: entity.status||'Unknown' } } };
    case 'DomainRegistry':
      return { ...common, domain_name: { rich_text: [{ text: { content: entity.primary_domain||'' } }] } };
    case 'VersionControlRegistry':
      return { ...common, repo_url: { url: entity.github_repo||null } };
    case 'InfrastructureRegistry':
      return { ...common };
    case 'EvidenceIndex':
      return { ...common, evidence_id: { rich_text: [{ text: { content: entity.evidence_id||'' } }] } };
    default:
      return common;
  }
}

try {
  const entityPath = arg('--entity');
  if (!entityPath) throw new Error('Missing --entity <path>');
  const apply = has('--apply');
  const entity = load(entityPath);
  const auto = load('etc/authority/auto-registry.json');
  const notion = load('etc/registries/notion.json');
  const plan = planForEntity(entity, auto, notion);

  if (!apply){
    console.log(JSON.stringify(plan, null, 2));
    process.exit(0);
  }

  for (const a of plan.actions){
    if (!a.target){
      console.log(`Skip ${a.create}: no target configured`);
      continue;
    }
    const props = propertiesFor(a.create, entity);
    console.log(`Creating ${a.create} in ${a.target} with title '${a.title}'`);
    await notionCreatePage(a.target, a.title, props);
  }
  console.log('Auto-registration completed');
} catch (e) {
  console.error('Auto-registration failed:', e.message);
  process.exit(1);
}

