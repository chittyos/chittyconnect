// Test ChittyConnect MCP endpoint
const url = process.env.CHITTYCONNECT_URL || 'http://localhost:8787';
console.log(`Testing MCP at: ${url}/mcp`);

fetch(`${url}/mcp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/list',
    id: 1
  })
}).then(r => r.json()).then(console.log).catch(console.error);
