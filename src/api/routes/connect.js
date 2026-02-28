/**
 * Connect routes: service discovery and onboarding
 *
 * POST /api/v1/connect/discover — rate-limited service discovery
 */

import { Hono } from "hono";
import { ChittyOSEcosystem } from "../../integrations/chittyos-ecosystem.js";

const connectRoutes = new Hono();

/**
 * POST /api/v1/connect/discover
 *
 * Rate-limited service discovery endpoint.
 * Limit is read from COMMAND_KV key `discover:rate_limit` (default 60/min).
 * Rate key: userId from auth context or SHA-256 of the API key.
 */
connectRoutes.post("/discover", async (c) => {
  const apiKeyInfo = c.get("apiKey") || {};
  const rateKey =
    apiKeyInfo.userId || apiKeyInfo.name || c.req.header("CF-Connecting-IP") || "anon";

  // Read rate limit from KV (default 60/min)
  let limit = 60;
  if (c.env.COMMAND_KV) {
    try {
      const stored = await c.env.COMMAND_KV.get("discover:rate_limit");
      if (stored) limit = parseInt(stored, 10) || 60;
    } catch {
      // KV unavailable — use default
    }
  }

  // Sliding window check via KV
  const windowKey = `discover:rate:${rateKey}:${Math.floor(Date.now() / 60000)}`;
  if (c.env.COMMAND_KV) {
    try {
      const current = parseInt(
        (await c.env.COMMAND_KV.get(windowKey)) || "0",
        10,
      );
      if (current >= limit) {
        return c.json(
          {
            error: "rate_limit_exceeded",
            message: `Discovery rate limit exceeded (${limit}/min). Try again shortly.`,
            limit,
          },
          429,
        );
      }
      await c.env.COMMAND_KV.put(windowKey, String(current + 1), {
        expirationTtl: 120,
      });
    } catch {
      // KV failure — allow request but don't track
    }
  }

  try {
    const ecosystem = new ChittyOSEcosystem(c.env);
    const services = await ecosystem.discoverServices();

    const servicesArray = Array.isArray(services)
      ? services
      : services?.services || [];

    return c.json({
      success: true,
      services: servicesArray.map((s) => ({
        name: s.name,
        url: s.url || `https://${s.name}.chitty.cc`,
        health: s.health_url || `https://${s.name}.chitty.cc/health`,
        status: s.status || "unknown",
      })),
      metadata: {
        timestamp: new Date().toISOString(),
        count: servicesArray.length,
      },
    });
  } catch (error) {
    return c.json(
      {
        error: "discovery_failed",
        message: error.message,
      },
      502,
    );
  }
});

export { connectRoutes };
