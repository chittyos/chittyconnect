#!/usr/bin/env node
/**
 * Generate ChittyConnect API Key
 * Usage: node scripts/generate-api-key.js [name] [rateLimit]
 */

import crypto from 'crypto';

const name = process.argv[2] || 'Default API Key';
const rateLimit = parseInt(process.argv[3]) || 1000;

// Generate secure API key
const apiKey = `chitty_${crypto.randomBytes(32).toString('hex')}`;

// Generate key metadata
const keyData = {
  status: 'active',
  rateLimit,
  name,
  createdAt: new Date().toISOString(),
  scope: ['full'],
  version: '1.0.0'
};

console.log('\n🔑 ChittyConnect API Key Generated\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`\n📌 API Key:\n${apiKey}\n`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('📊 Key Details:');
console.log(`   Name: ${name}`);
console.log(`   Rate Limit: ${rateLimit} req/min`);
console.log(`   Status: active`);
console.log(`   Scope: full access\n`);

console.log('🚀 Store in Cloudflare KV:\n');
console.log(`wrangler kv:key put --binding=API_KEYS "key:${apiKey}" '${JSON.stringify(keyData)}'\n`);

console.log('💡 Use in Custom GPT:');
console.log('   Authentication: API Key');
console.log('   Header: X-ChittyOS-API-Key');
console.log(`   Value: ${apiKey}\n`);

console.log('🔗 Endpoints:');
console.log('   Production: https://itchitty.com/api/*');
console.log('   Connect: https://connect.chitty.cc/api/*\n');

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log("It's Chitty - Model Agnostic & CloudeConscious™\n");
