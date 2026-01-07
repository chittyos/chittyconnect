/**
 * Discovery routes: Bootstrap endpoint for agent discovery
 * Implements: chitty.cc/.well-known/chitty.json
 */

import { Hono } from 'hono';
import { ChittyOSEcosystem } from '../../integrations/chittyos-ecosystem.js';

export const discoveryRoutes = new Hono();

// In-memory cache for discovery document (5 minute TTL)
let cachedDiscovery = null;
let cacheExpiry = 0;
const CACHE_TTL = 300000; // 5 minutes in milliseconds

/**
 * GET /.well-known/chitty.json
 * Bootstrap discovery document for automatic agent configuration
 */
discoveryRoutes.get('/chitty.json', async (c) => {
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
      console.warn('[Discovery] Failed to fetch services from ChittyRegistry:', error.message);
      // Continue with empty services array - not critical for discovery
    }

    // Extract services array from response (handles both array and object formats)
    const servicesArray = Array.isArray(servicesData)
      ? servicesData
      : (servicesData?.services || []);

    // Map services to discovery format
    const servicesFormatted = servicesArray.map(service => ({
      name: service.name,
      url: service.url || `https://${service.name}.chitty.cc`,
      mcp: `https://mcp.chitty.cc/${service.name}/mcp`,
      api: `https://api.chitty.cc/${service.name}/api`,
      health: service.health_url || `https://${service.name}.chitty.cc/health`,
      status: service.status || 'unknown'
    }));

    // Build discovery document
    const discoveryDoc = {
      version: '1.0.0',
      ecosystem: 'ChittyOS',
      updated_at: new Date().toISOString(),

      endpoints: {
        connect_base: 'https://connect.chitty.cc',
        api_base: 'https://api.chitty.cc',
        mcp_base: 'https://mcp.chitty.cc',
        sse: 'https://connect.chitty.cc/sse',
        auth: 'https://auth.chitty.cc',
        registry: 'https://registry.chitty.cc',
        register: 'https://register.chitty.cc'
      },

      capabilities: {
        mcp: {
          protocol_version: '2024-11-05',
          tools_count: 23,
          supports_streaming: true,
          session_management: true
        },
        api: {
          openapi_spec: 'https://connect.chitty.cc/openapi.json',
          version: 'v1',
          authentication: ['api_key', 'bearer_token'],
          rate_limiting: true
        },
        services: {
          discovery: 'https://registry.chitty.cc/api/services',
          health_check: 'https://connect.chitty.cc/health'
        }
      },

      services: servicesFormatted,

      onboarding: {
        register_url: 'https://register.chitty.cc',
        get_started: 'https://get.chitty.cc',
        device_code_flow: 'https://auth.chitty.cc/device',
        docs: 'https://docs.chitty.cc'
      },

      resource_uri_scheme: 'resource://connect/{session_id}/{sha256}-{basename}',

      context_sync: {
        files: {
          set_active: 'https://api.chitty.cc/api/context/files/set-active',
          sync_report: 'https://api.chitty.cc/api/context/files/sync-report',
          upload: 'https://api.chitty.cc/api/files/upload',
          presign: 'https://api.chitty.cc/api/files/presign'
        },
        tasks: {
          list: 'https://api.chitty.cc/api/context/tasks',
          create: 'https://api.chitty.cc/api/context/tasks',
          update: 'https://api.chitty.cc/api/context/tasks/{taskId}'
        }
      }
    };

    // Cache the discovery document
    cachedDiscovery = discoveryDoc;
    cacheExpiry = now + CACHE_TTL;

    return c.json(discoveryDoc);
  } catch (error) {
    console.error('[Discovery] Error generating discovery document:', error);
    return c.json(
      {
        error: 'discovery_failed',
        message: 'Failed to generate discovery document'
      },
      500
    );
  }
});

export default discoveryRoutes;
