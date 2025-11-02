#!/usr/bin/env node
/**
 * Generate MCP API Key
 *
 * This script generates a new API key for MCP access and stores it in
 * the API_KEYS KV namespace.
 *
 * Usage:
 *   node scripts/generate-mcp-api-key.js --name "Claude Desktop" --user "chitty_user_123"
 *
 * Environment variables required:
 *   CLOUDFLARE_ACCOUNT_ID - Your Cloudflare account ID
 *   CLOUDFLARE_API_TOKEN - Your Cloudflare API token with KV write permissions
 */

import crypto from "crypto";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const KV_NAMESPACE_ID = "3a29a9de28c84b7e8b87070cbf006415"; // API_KEYS namespace

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  name: "Unnamed API Key",
  userId: null,
  scopes: ["mcp:read", "mcp:write"],
  rateLimit: 1000,
  expiresAt: null,
};

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--name":
      options.name = args[++i];
      break;
    case "--user":
      options.userId = args[++i];
      break;
    case "--rate-limit":
      options.rateLimit = parseInt(args[++i]);
      break;
    case "--expires":
      options.expiresAt = args[++i];
      break;
  }
}

async function generateAPIKey() {
  if (!ACCOUNT_ID || !API_TOKEN) {
    console.error("❌ Error: Missing environment variables");
    console.error("   Please set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN");
    console.error("");
    console.error("   export CLOUDFLARE_ACCOUNT_ID=0bc21e3a5a9de1a4cc843be9c3e98121");
    console.error("   export CLOUDFLARE_API_TOKEN=your-api-token");
    process.exit(1);
  }

  // Generate secure random API key
  const keyBytes = crypto.randomBytes(32);
  const apiKey = "chitty_" + keyBytes.toString("hex");

  // Prepare key data
  const keyData = {
    status: "active",
    name: options.name,
    userId: options.userId,
    scopes: options.scopes,
    rateLimit: options.rateLimit,
    expiresAt: options.expiresAt,
    metadata: {},
    createdAt: new Date().toISOString(),
  };

  // Store in Cloudflare KV
  console.log("🔑 Generating API key...");

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/key:${apiKey}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(keyData),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cloudflare API error: ${error}`);
    }

    console.log("");
    console.log("✅ API Key Generated Successfully");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
    console.log("  🔐 API Key:");
    console.log(`     ${apiKey}`);
    console.log("");
    console.log("  📝 Details:");
    console.log(`     Name:        ${options.name}`);
    console.log(`     User ID:     ${options.userId || "N/A"}`);
    console.log(`     Rate Limit:  ${options.rateLimit} req/min`);
    console.log(`     Scopes:      ${options.scopes.join(", ")}`);
    console.log(`     Status:      ${keyData.status}`);
    console.log(`     Created:     ${keyData.createdAt}`);
    console.log(`     Expires:     ${options.expiresAt || "Never"}`);
    console.log("");
    console.log("  📋 Usage:");
    console.log("     Add this header to your MCP requests:");
    console.log(`     X-ChittyOS-API-Key: ${apiKey}`);
    console.log("");
    console.log("  🔗 Test endpoint:");
    console.log(
      `     curl https://chittyconnect-staging.ccorp.workers.dev/mcp/tools/list \\`,
    );
    console.log(`       -H "X-ChittyOS-API-Key: ${apiKey}"`);
    console.log("");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("");
    console.log("⚠️  IMPORTANT: Store this API key securely!");
    console.log(
      "   It will not be shown again. If lost, generate a new key.",
    );
    console.log("");
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

// Show help if requested
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Generate MCP API Key

Usage:
  node scripts/generate-mcp-api-key.js [options]

Options:
  --name <name>         API key name (default: "Unnamed API Key")
  --user <userId>       User ID associated with this key
  --rate-limit <limit>  Rate limit in requests per minute (default: 1000)
  --expires <date>      Expiration date in ISO format (default: never)
  --help, -h            Show this help message

Environment Variables:
  CLOUDFLARE_ACCOUNT_ID   Cloudflare account ID (required)
  CLOUDFLARE_API_TOKEN    Cloudflare API token (required)

Examples:
  # Generate basic API key
  node scripts/generate-mcp-api-key.js --name "Claude Desktop"

  # Generate key for specific user with rate limit
  node scripts/generate-mcp-api-key.js \\
    --name "Production API" \\
    --user "chitty_user_123" \\
    --rate-limit 5000

  # Generate key with expiration
  node scripts/generate-mcp-api-key.js \\
    --name "Test Key" \\
    --expires "2025-12-31T23:59:59Z"
`);
  process.exit(0);
}

generateAPIKey();
