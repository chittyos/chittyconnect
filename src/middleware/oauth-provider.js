/**
 * OAuth 2.1 Provider for MCP endpoints
 *
 * Provides OAuth 2.1 with PKCE for Claude Desktop/Code, Notion, and other
 * MCP clients that require OAuth authentication.
 *
 * Uses @cloudflare/workers-oauth-provider with ChittyAuth as upstream IdP.
 * MCP transport is handled by McpConnectAgent (Durable Object extending McpAgent),
 * which implements SSE + Streamable HTTP transports via the Cloudflare Agents SDK.
 *
 * Only protects mcp.chitty.cc/mcp — connect.chitty.cc/mcp/* continues
 * using API key auth via the Hono router (backward compatible).
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/middleware/oauth-provider
 * @see chittycanon://docs/tech/spec/mcp-transport
 */

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { McpConnectAgent } from "../mcp/agent.js";
import { ChittyIDClient } from "../lib/chittyid-client.js";

/**
 * Create the OAuth-wrapped worker handler
 *
 * @param {import("hono").Hono} honoApp - The existing Hono application
 * @returns {OAuthProvider} OAuth provider instance
 */
export function createOAuthProvider(honoApp) {
  return new OAuthProvider({
    // Hostname-specific: only mcp.chitty.cc/mcp is OAuth-protected.
    // connect.chitty.cc/mcp/* falls through to defaultHandler (Hono + API key auth).
    apiRoute: "https://mcp.chitty.cc/mcp",

    apiHandler: McpConnectAgent.serve("/mcp", { binding: "MCP_AGENT" }),

    defaultHandler: createDefaultHandler(honoApp),

    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",

    scopesSupported: ["mcp:read", "mcp:write", "mcp:admin"],

    refreshTokenTTL: 2592000, // 30 days
  });
}

/**
 * Default handler: OAuth authorize flow + passthrough to Hono app
 */
function createDefaultHandler(honoApp) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);

      if (url.pathname === "/authorize") {
        return handleAuthorize(request, env);
      }

      // Everything else → existing Hono app
      return honoApp.fetch(request, env, ctx);
    },
  };
}

/**
 * Resolve a ChittyID for an MCP client.
 *
 * Looks up `mcp-client:{clientId}` in KV. If not found, mints a new
 * ChittyID (type P / Synthetic) via id.chitty.cc and caches it.
 * This gives each MCP client (Notion, Claude Desktop, etc.) a stable
 * identity for audit trails and per-client access control.
 *
 * @canon chittycanon://gov/governance#core-types
 */
async function resolveClientChittyId(clientId, env) {
  const kvKey = `mcp-client:${clientId}`;

  // Check KV cache first
  const cached = await env.TOKEN_KV.get(kvKey, { type: "json" });
  if (cached?.chittyId) {
    return cached.chittyId;
  }

  // Mint a new ChittyID (P/Synthetic) for this client
  try {
    const client = new ChittyIDClient({
      env,
      token: env.CHITTY_ID_SERVICE_TOKEN,
    });
    const result = await client.mint("person", { trust: 2 });
    const chittyId = result.chittyId || result.id;

    if (chittyId) {
      await env.TOKEN_KV.put(
        kvKey,
        JSON.stringify({
          chittyId,
          clientId,
          mintedAt: new Date().toISOString(),
          type: "mcp-client",
        }),
      );
      console.log(`[OAuth] Minted ChittyID ${chittyId} for client ${clientId}`);
      return chittyId;
    }
  } catch (err) {
    console.error(
      `[OAuth] Failed to mint ChittyID for client ${clientId}: ${err.message}`,
    );
  }

  // Fallback: deterministic synthetic ID so we never block auth
  return `mcp-client:${clientId}`;
}

/**
 * Handle OAuth authorization
 *
 * Parses the OAuth request, validates the client, and completes authorization.
 * Each client gets a stable ChittyID (type P / Synthetic) for per-client
 * identity and audit trails. Auto-approves registered clients — when ChittyAuth
 * gains a login UI, this can redirect there for per-user consent.
 */
async function handleAuthorize(request, env) {
  // Notion appends ?spaceId=...&userId=... to the redirect_uri, which causes
  // an exact-match failure against the registered base URI. Strip the query
  // params for validation, then re-append them to the final redirect.
  const url = new URL(request.url);
  const rawRedirect = url.searchParams.get("redirect_uri") || "";
  let extraRedirectParams = "";

  if (rawRedirect) {
    try {
      const redirectUrl = new URL(rawRedirect);
      if (redirectUrl.search) {
        extraRedirectParams = redirectUrl.search;
        redirectUrl.search = "";
        url.searchParams.set("redirect_uri", redirectUrl.toString());
        request = new Request(url.toString(), request);
      }
    } catch {
      // Invalid redirect_uri — let the provider handle the error
    }
  }

  console.log(
    `[OAuth] Authorize: client_id=${url.searchParams.get("client_id")} redirect_uri=${url.searchParams.get("redirect_uri")}`,
  );

  let oauthReqInfo;
  try {
    oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (err) {
    console.error(
      `[OAuth] parseAuthRequest FAILED: ${err.message} | redirect_uri=${rawRedirect}`,
    );
    return new Response(`Invalid OAuth request: ${err.message}`, {
      status: 400,
    });
  }

  if (!oauthReqInfo) {
    return new Response("Invalid OAuth request", { status: 400 });
  }

  // Look up client metadata
  let clientInfo;
  try {
    clientInfo = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId);
  } catch {
    // Client not found — dynamic registration may be required
  }

  // Resolve a per-client ChittyID (type P / Synthetic).
  // @canon: chittycanon://gov/governance#core-types
  const clientId = oauthReqInfo.clientId || "unknown";
  const chittyId = await resolveClientChittyId(clientId, env);

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: chittyId,
    metadata: {
      client: clientInfo?.clientName || clientId,
      chittyId,
      authorizedAt: new Date().toISOString(),
    },
    scope: oauthReqInfo.scope || ["mcp:read", "mcp:write"],
    props: {
      userId: chittyId,
      chittyId,
      source: "oauth",
    },
  });

  // Build final redirect URL:
  // 1. Add RFC 9207 issuer identification (iss) — some clients (Notion)
  //    validate this for security and fail with oauth_security_error without it.
  // 2. Re-append Notion's extra query params (spaceId, userId) to the redirect.
  const redirectUrl = new URL(redirectTo);
  redirectUrl.searchParams.set("iss", new URL(request.url).origin);

  if (extraRedirectParams) {
    const extra = new URLSearchParams(extraRedirectParams);
    for (const [key, value] of extra) {
      redirectUrl.searchParams.set(key, value);
    }
  }

  return Response.redirect(redirectUrl.toString(), 302);
}
