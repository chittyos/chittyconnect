/**
 * Discovery routes: Bootstrap endpoint for agent discovery
 * Implements: chitty.cc/.well-known/chitty.json
 */

import { Hono } from "hono";
import { ChittyOSEcosystem } from "../../integrations/chittyos-ecosystem.js";
import { MCP_TOOL_NAMES } from "../../mcp/tool-registry.js";
import { getServiceCatalogEntries } from "../../lib/service-catalog.js";

export const discoveryRoutes = new Hono();

// In-memory cache for discovery document (5 minute TTL)
let cachedDiscovery = null;
let cacheExpiry = 0;
const CACHE_TTL = 300000; // 5 minutes in milliseconds

/**
 * GET /.well-known/chitty.json
 * Bootstrap discovery document for automatic agent configuration
 */
discoveryRoutes.get("/chitty.json", async (c) => {
  try {
    const now = Date.now();

    // Return cached document if still valid
    if (cachedDiscovery && now < cacheExpiry) {
      return c.json(cachedDiscovery);
    }

    // Build discovery document
    const env = c.env;
    const ecosystem = new ChittyOSEcosystem(env);

    // Discover services from ChittyRegistry (with ecosystem's built-in caching)
    let servicesData = { services: [] };
    try {
      servicesData = await ecosystem.discoverServices();
    } catch (error) {
      console.warn(
        "[Discovery] Failed to fetch services from ChittyRegistry:",
        error.message,
      );
      // Continue with empty services array - not critical for discovery
    }

    // Extract services array from response (handles both array and object formats)
    const servicesArray = Array.isArray(servicesData)
      ? servicesData
      : servicesData?.services || [];

    // Augment registry results with a local, always-available service catalog so
    // discovery-driven clients don't end up showing only a couple entries.
    // Registry remains the source of truth when populated, but this prevents
    // "empty or tiny service list" regressions.
    const catalogEntries = getServiceCatalogEntries(env);

    // mcp base can be served from multiple hostnames (e.g. mcp.chitty.cc, mcp.ch1tty.com).
    // Preserve canonical defaults, but emit self-consistent links for the host the client used.
    const host = (c.req.header("host") || "").toLowerCase();
    const isCh1ttyHost = host === "ch1tty.com" || host.endsWith(".ch1tty.com");
    const mcpBase = isCh1ttyHost
      ? "https://mcp.ch1tty.com"
      : "https://mcp.chitty.cc";

    const normalizeService = function(service) {
      const name = service?.name || service?.id || "";
      const url = service?.url || (name ? `https://${name}.chitty.cc` : "");

      let sub = service?.sub || service?.subdomain;
      if (!sub && url) {
        try {
          sub = new URL(url).hostname.split(".")[0];
        } catch {
          // ignore
        }
      }
      if (!sub) sub = name;

      return {
        name,
        url,
        sub,
        health_url: service?.health_url,
        status: service?.status,
      };
    }

    const normalized = [];
    const seen = new Set();

    for (const s of servicesArray) {
      const n = normalizeService(s);
      if (!n.name || !n.sub) continue;
      const key = `${n.sub}|${n.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(n);
    }

    for (const entry of catalogEntries) {
      const n = normalizeService({
        name: entry.id,
        url: entry.url,
        sub: entry.sub,
      });
      const key = `${n.sub}|${n.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      normalized.push(n);
    }

    // Map services to discovery format
    const servicesFormatted = normalized.map((service) => ({
      name: service.name,
      url: service.url,
      // Primary MCP link: through the mcpBase gateway/proxy
      mcp: `${mcpBase}/${service.sub}/mcp`,
      // Direct MCP link: useful for clients that prefer the origin service
      direct_mcp: `${service.url.replace(/\/$/, "")}/mcp`,
      // Legacy API field kept for backward compatibility
      api: `https://api.chitty.cc/${service.sub}/api`,
      direct_api: `${service.url.replace(/\/$/, "")}/api`,
      health:
        service.health_url || `${service.url.replace(/\/$/, "")}/health`,
      status: service.status || "unknown",
    }));

    // Build discovery document
    const discoveryDoc = {
      version: "1.0.0",
      ecosystem: "ChittyOS",
      updated_at: new Date().toISOString(),

      endpoints: {
        connect_base: "https://connect.chitty.cc",
        api_base: "https://api.chitty.cc",
        mcp_base: mcpBase,
        sse: "https://connect.chitty.cc/sse",
        auth: "https://auth.chitty.cc",
        registry: "https://registry.chitty.cc",
        register: "https://register.chitty.cc",
      },

      capabilities: {
        mcp: {
          protocol_version: "2025-06-18",
          tools_count: MCP_TOOL_NAMES.size,
          supports_streaming: true,
          session_management: true,
          oauth_discovery:
            `${mcpBase}/.well-known/oauth-authorization-server`,
        },
        api: {
          openapi_spec: "https://connect.chitty.cc/openapi.json",
          version: "v1",
          authentication: ["api_key", "bearer_token"],
          rate_limiting: true,
        },
        services: {
          discovery: "https://registry.chitty.cc/api/services",
          health_check: "https://connect.chitty.cc/health",
        },
      },

      services: servicesFormatted,

      onboarding: {
        register_url: "https://register.chitty.cc",
        get_started: "https://get.chitty.cc",
        device_code_flow: "https://auth.chitty.cc/device",
        docs: "https://docs.chitty.cc",
      },

      resource_uri_scheme:
        "resource://connect/{session_id}/{sha256}-{basename}",

      context_sync: {
        files: {
          set_active: "https://api.chitty.cc/api/context/files/set-active",
          sync_report: "https://api.chitty.cc/api/context/files/sync-report",
          upload: "https://api.chitty.cc/api/files/upload",
          presign: "https://api.chitty.cc/api/files/presign",
        },
        tasks: {
          list: "https://api.chitty.cc/api/context/tasks",
          create: "https://api.chitty.cc/api/context/tasks",
          update: "https://api.chitty.cc/api/context/tasks/{taskId}",
        },
      },
    };

    // Cache the discovery document
    cachedDiscovery = discoveryDoc;
    cacheExpiry = now + CACHE_TTL;

    return c.json(discoveryDoc);
  } catch (error) {
    console.error("[Discovery] Error generating discovery document:", error);
    return c.json(
      {
        error: "discovery_failed",
        message: "Failed to generate discovery document",
      },
      500,
    );
  }
});

export default discoveryRoutes;
