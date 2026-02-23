/**
 * OAuth 2.1 Provider for MCP endpoints
 *
 * Provides OAuth 2.1 with PKCE for Claude Desktop Cowork and other
 * MCP clients that require OAuth authentication.
 *
 * Uses @cloudflare/workers-oauth-provider with ChittyAuth as upstream IdP.
 * Only protects mcp.chitty.cc/mcp — connect.chitty.cc/mcp/* continues
 * using API key auth via the Hono router (backward compatible).
 */

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";

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

    apiHandler: createMcpJsonRpcHandler(honoApp),

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
 * Handle OAuth authorization
 *
 * Parses the OAuth request, validates the client, and completes authorization.
 * In production this would redirect to ChittyAuth's login page; for now it
 * auto-approves registered clients (sufficient for Claude Cowork's PKCE flow
 * where the user has already authenticated in the app).
 */
async function handleAuthorize(request, env) {
  let oauthReqInfo;
  try {
    oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (err) {
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

  // Complete authorization
  // TODO: Redirect to ChittyAuth login page for interactive user authentication.
  // For now, auto-approve since Claude Cowork handles its own user auth.
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReqInfo,
    userId: "chittyos-mcp-user",
    metadata: {
      client: clientInfo?.clientName || oauthReqInfo.clientId || "unknown",
      authorizedAt: new Date().toISOString(),
    },
    scope: oauthReqInfo.scope || ["mcp:read", "mcp:write"],
    props: {
      userId: "chittyos-mcp-user",
      source: "oauth",
    },
  });

  return Response.redirect(redirectTo, 302);
}

/**
 * MCP JSON-RPC protocol handler
 *
 * Implements the MCP Streamable HTTP transport (JSON-RPC 2.0 over POST).
 * Delegates tool listing/calling to the existing Hono MCP REST endpoints.
 */
function createMcpJsonRpcHandler(honoApp) {
  return {
    async fetch(request, env, ctx) {
      // Only POST is supported for MCP Streamable HTTP
      if (request.method === "GET") {
        // SSE endpoint for server-initiated messages (not yet implemented)
        return new Response("SSE not implemented for MCP", { status: 501 });
      }

      if (request.method === "DELETE") {
        // Session termination
        return new Response(null, { status: 204 });
      }

      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return jsonRpcError(null, -32700, "Parse error");
      }

      // Handle batch requests
      if (Array.isArray(body)) {
        const results = await Promise.all(
          body.map((req) =>
            handleJsonRpcRequest(req, request, honoApp, env, ctx),
          ),
        );
        // Filter out notifications (no id = no response)
        const responses = results.filter(Boolean);
        if (responses.length === 0) return new Response(null, { status: 204 });
        return new Response(JSON.stringify(responses), {
          headers: { "Content-Type": "application/json" },
        });
      }

      const result = await handleJsonRpcRequest(
        body,
        request,
        honoApp,
        env,
        ctx,
      );
      if (!result) return new Response(null, { status: 204 });
      return result;
    },
  };
}

async function handleJsonRpcRequest(body, request, honoApp, env, ctx) {
  const { jsonrpc, method, params, id } = body;

  // Notifications have no id — no response expected
  const isNotification = id === undefined;

  if (jsonrpc !== "2.0") {
    if (isNotification) return null;
    return jsonRpcError(id, -32600, "Invalid Request: expected jsonrpc 2.0");
  }

  try {
    switch (method) {
      case "initialize":
        return jsonRpcResponse(id, {
          protocolVersion: "2025-03-26",
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
          },
          serverInfo: {
            name: "chittyconnect",
            version: "2.0.2",
          },
        });

      case "notifications/initialized":
        // Client acknowledgment — no response
        return null;

      case "ping":
        return jsonRpcResponse(id, {});

      case "tools/list": {
        const internalReq = new Request(
          `${new URL(request.url).origin}/mcp/tools/list`,
          { headers: { "Content-Type": "application/json" } },
        );
        const resp = await honoApp.fetch(internalReq, env, ctx);
        const data = await resp.json();
        return jsonRpcResponse(id, data);
      }

      case "tools/call": {
        const internalReq = new Request(
          `${new URL(request.url).origin}/mcp/tools/call`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: params?.name,
              arguments: params?.arguments || {},
            }),
          },
        );
        const resp = await honoApp.fetch(internalReq, env, ctx);
        const data = await resp.json();
        return jsonRpcResponse(id, data);
      }

      case "resources/list": {
        const internalReq = new Request(
          `${new URL(request.url).origin}/mcp/resources/list`,
          { headers: { "Content-Type": "application/json" } },
        );
        const resp = await honoApp.fetch(internalReq, env, ctx);
        const data = await resp.json();
        return jsonRpcResponse(id, data);
      }

      case "resources/read": {
        const uri = params?.uri || "";
        const internalReq = new Request(
          `${new URL(request.url).origin}/mcp/resources/read?uri=${encodeURIComponent(uri)}`,
          { headers: { "Content-Type": "application/json" } },
        );
        const resp = await honoApp.fetch(internalReq, env, ctx);
        const data = await resp.json();
        return jsonRpcResponse(id, data);
      }

      case "prompts/list":
        return jsonRpcResponse(id, { prompts: [] });

      default:
        if (isNotification) return null;
        return jsonRpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (error) {
    console.error(`[MCP JSON-RPC] Error handling ${method}:`, error);
    if (isNotification) return null;
    return jsonRpcError(id, -32603, `Internal error: ${error.message}`);
  }
}

function jsonRpcResponse(id, result) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", result, id }), {
    headers: { "Content-Type": "application/json" },
  });
}

function jsonRpcError(id, code, message) {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id }),
    {
      status: code === -32700 || code === -32600 ? 400 : 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}
