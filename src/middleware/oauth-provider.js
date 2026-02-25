/**
 * OAuth 2.1 Provider for MCP endpoints
 *
 * Provides OAuth 2.1 with PKCE for Claude Desktop/Code and other
 * MCP clients that require OAuth authentication.
 *
 * Uses @cloudflare/workers-oauth-provider with ChittyAuth as upstream IdP.
 * Only protects mcp.chitty.cc/mcp — connect.chitty.cc/mcp/* continues
 * using API key auth via the Hono router (backward compatible).
 *
 * @canonical-uri chittycanon://core/services/chittyconnect/middleware/oauth-provider
 * @see chittycanon://docs/tech/spec/mcp-transport
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
  // FIXME(canonical): Hardcoded userId violates per-actor identification.
  // Must resolve to authenticated ChittyID (type P) via ChittyAuth.
  // @canon: chittycanon://gov/governance#core-types
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
 * MCP Streamable HTTP transport handler
 *
 * Implements the MCP Streamable HTTP transport (2025-03-26):
 * - POST /mcp → JSON-RPC 2.0 request/response
 * - GET  /mcp → SSE stream for server-initiated notifications
 * - DELETE /mcp → Session termination
 *
 * Delegates tool listing/calling to the existing Hono MCP REST endpoints.
 */
function createMcpJsonRpcHandler(honoApp) {
  return {
    async fetch(request, env, ctx) {
      // Resolve or generate session ID
      const sessionId =
        request.headers.get("Mcp-Session-Id") || crypto.randomUUID();

      /** Attach the session header to every outgoing response. */
      function withSession(body, init = {}) {
        const headers = new Headers(init.headers);
        headers.set("Mcp-Session-Id", sessionId);
        return new Response(body, { ...init, headers });
      }

      if (request.method === "GET") {
        const accept = request.headers.get("Accept") || "";
        if (!accept.includes("text/event-stream")) {
          return new Response("Not Acceptable: requires Accept: text/event-stream", { status: 406 });
        }
        return handleSseStream(sessionId);
      }

      if (request.method === "DELETE") {
        console.log(`[MCP] Session terminated: ${sessionId}`);
        return withSession(null, { status: 204 });
      }

      if (request.method !== "POST") {
        return new Response("Method not allowed", { status: 405 });
      }

      let body;
      try {
        body = await request.json();
      } catch (err) {
        console.warn(`[MCP JSON-RPC] Body parse failed: ${err.message}`);
        return jsonRpcError(null, -32700, "Parse error");
      }

      // Handle batch requests
      if (Array.isArray(body)) {
        const results = await Promise.all(
          body.map((req) =>
            handleJsonRpcRequest(req, request, honoApp, env, ctx),
          ),
        );
        const responses = results.filter(Boolean);
        if (responses.length === 0) {
          return withSession(null, { status: 204 });
        }
        // Extract JSON bodies from Response objects before serializing
        const bodies = await Promise.all(
          responses.map((r) => r.json()),
        );
        return withSession(JSON.stringify(bodies), {
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
      if (!result) {
        return withSession(null, { status: 204 });
      }

      // Inject session header into the JSON-RPC response
      const original = result instanceof Response ? result : new Response(null);
      return withSession(original.body, {
        status: original.status,
        headers: original.headers,
      });
    },
  };
}

/**
 * SSE stream for server-initiated MCP notifications (GET /mcp)
 *
 * Opens a text/event-stream connection. Sends a keepalive comment
 * immediately so clients confirm the connection is live, then holds
 * the stream open with periodic heartbeats (every 30 s) until the
 * client disconnects.
 */
function handleSseStream(sessionId) {
  console.log(`[MCP SSE] Stream opened: ${sessionId}`);
  const encoder = new TextEncoder();
  let interval;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(": connected\n\n"));

      // Periodic heartbeat to keep the connection alive
      interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch (err) {
          console.log(`[MCP SSE] Heartbeat stopped for session ${sessionId}: ${err.message}`);
          clearInterval(interval);
        }
      }, 30_000);
    },
    cancel() {
      clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Mcp-Session-Id": sessionId,
    },
  });
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
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: request.headers.get("Authorization") || "",
            },
          },
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
            headers: {
              "Content-Type": "application/json",
              Authorization: request.headers.get("Authorization") || "",
            },
            body: JSON.stringify({
              name: params?.name,
              arguments: params?.arguments || {},
            }),
          },
        );
        const resp = await honoApp.fetch(internalReq, env, ctx);
        let data;
        try {
          data = await resp.json();
        } catch {
          console.error(`[MCP JSON-RPC] tools/call response not JSON (${resp.status})`);
          return jsonRpcError(id, -32603, `Internal error: tools/call returned non-JSON (${resp.status})`);
        }
        return jsonRpcResponse(id, data);
      }

      case "resources/list": {
        const internalReq = new Request(
          `${new URL(request.url).origin}/mcp/resources/list`,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: request.headers.get("Authorization") || "",
            },
          },
        );
        const resp = await honoApp.fetch(internalReq, env, ctx);
        const data = await resp.json();
        return jsonRpcResponse(id, data);
      }

      case "resources/read": {
        const uri = params?.uri || "";
        const internalReq = new Request(
          `${new URL(request.url).origin}/mcp/resources/read?uri=${encodeURIComponent(uri)}`,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: request.headers.get("Authorization") || "",
            },
          },
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
