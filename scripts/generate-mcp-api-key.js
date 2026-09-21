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
 * --quiet prints ONLY the key on stdout (no banner, diagnostics to stderr) so the
 * value can be piped straight into a secret store without being rendered:
 *   node scripts/generate-mcp-api-key.js --name x --user y --quiet | <consumer>
 *
 * Environment variables required:
 *   CLOUDFLARE_ACCOUNT_ID - Your Cloudflare account ID
 *   CLOUDFLARE_API_TOKEN - Your Cloudflare API token with KV write permissions
 */

import crypto from "crypto";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
/**
 * Default API_KEYS namespace.
 *
 * Must match the `API_KEYS` binding in wrangler.jsonc — all three environments share
 * one namespace (lines 139 / 282 / 426). This previously read
 * "3a29a9de28c84b7e8b87070cbf006415", which is not the API_KEYS namespace: the script
 * wrote a key that nothing could ever read and reported success, a silent failure that
 * surfaces later as an unexplained 401. Override with --namespace-id.
 */
const DEFAULT_KV_NAMESPACE_ID = "cf6da7757caf4da5a8a365be2174f391";

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  name: "Unnamed API Key",
  userId: null,
  scopes: ["mcp:read", "mcp:write"],
  rateLimit: 1000,
  expiresAt: null,
  namespaceId: DEFAULT_KV_NAMESPACE_ID,
  quiet: false,
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
    case "--namespace-id":
      options.namespaceId = args[++i];
      break;
    case "--quiet":
    case "-q":
      options.quiet = true;
      break;
  }
}

/** Human-facing output. Suppressed entirely by --quiet. */
function say(line = "") {
  if (!options.quiet) console.log(line);
}

async function generateAPIKey() {
  if (!options.namespaceId || !/^[0-9a-f]{32}$/.test(options.namespaceId)) {
    console.error(
      `❌ Error: --namespace-id must be a 32-character hex id (got: ${options.namespaceId || "empty"})`,
    );
    process.exit(1);
  }

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
  say("🔑 Generating API key...");

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${options.namespaceId}/values/key:${apiKey}`,
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

    if (options.quiet) {
      // ONLY the key on stdout — nothing else — so a caller can pipe it directly.
      process.stdout.write(apiKey + "\n");
      return;
    }

    say("");
    say("✅ API Key Generated Successfully");
    say("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    say("");
    say("  🔐 API Key:");
    say(`     ${apiKey}`);
    say("");
    say("  📝 Details:");
    say(`     Name:        ${options.name}`);
    say(`     User ID:     ${options.userId || "N/A"}`);
    say(`     Namespace:   ${options.namespaceId}`);
    say(`     Rate Limit:  ${options.rateLimit} req/min`);
    say(`     Scopes:      ${options.scopes.join(", ")}`);
    say(`     Status:      ${keyData.status}`);
    say(`     Created:     ${keyData.createdAt}`);
    say(`     Expires:     ${options.expiresAt || "Never"}`);
    say("");
    say("  📋 Usage: send it as the X-ChittyOS-API-Key header.");
    say("     The key is printed once above and is not repeated here —");
    say("     use --quiet to pipe it somewhere without rendering it.");
    say("");
    say("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    say("");
    say("⚠️  IMPORTANT: Store this API key securely!");
    say("   It will not be shown again. If lost, generate a new key.");
    say("");
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
  --namespace-id <id>   API_KEYS KV namespace id (default: the production namespace)
  --quiet, -q           Print ONLY the key on stdout — no banner, no details.
                        For piping into a secret store without rendering the value.
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

  # Machine use: emit only the key, pipe it onward without rendering it
  node scripts/generate-mcp-api-key.js --name "svc" --user "u1" --quiet
`);
  process.exit(0);
}

generateAPIKey();
