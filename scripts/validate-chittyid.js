#!/usr/bin/env node
// Basic structural validator for ChittyID strings
// Usage: node scripts/validate-chittyid.js --id "01-C-ACT-4829-PEO-Q5-7-0"

function arg(flag, def = undefined) { const i = process.argv.indexOf(flag); return i>-1 ? process.argv[i+1] : def; }

const LLL = new Set(['ACT','EMG','MTR','EXP','ARC']);
const TYPES = new Set(['PEO','PLACE','PROP','EVNT','AUTH','INFO','FACT','CONTEXT','ACTOR']);

function validate(id){
  const issues = [];
  const parts = (id||'').split('-');
  if (parts.length !== 8) issues.push(`Expected 8 segments, got ${parts.length}`);
  const [VV,G,LLLseg,SSSS,T,YM,C,X] = parts;
  if (!/^\d{2}$/.test(VV||'')) issues.push('VV must be 2 digits');
  if (!/^[CE]$/.test(G||'')) issues.push('G must be C or E');
  if (!LLL.has(LLLseg)) issues.push(`LLL invalid (${LLLseg})`);
  if (!/^\d+$/.test(SSSS||'')) issues.push('SSSS must be digits');
  if (!TYPES.has(T)) issues.push(`T invalid (${T})`);
  if (!/^[0-9A-Z]+$/.test(YM||'')) issues.push('YM must be base36 [0-9A-Z]+');
  if (!/^[0-9A-Z]$/.test(C||'')) issues.push('C must be single alnum (checksum)');
  if (!/^[0-9A-Z]$/.test(X||'')) issues.push('X must be single alnum');
  return { valid: issues.length===0, issues };
}

try {
  const id = arg('--id');
  if (!id) { console.error('Missing --id <ChittyID>'); process.exit(2); }
  const res = validate(id);
  if (res.valid) { console.log('VALID'); process.exit(0); }
  console.error('INVALID:', res.issues.join('; '));
  process.exit(3);
} catch (e) {
  console.error('Validation failed:', e.message);
  process.exit(1);
}

