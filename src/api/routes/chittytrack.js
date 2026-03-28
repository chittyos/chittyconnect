/**
 * ChittyTrack API Routes
 * Centralized observability proxy for ChittyOS
 *
 * Service token retrieved dynamically from 1Password with automatic
 * failover to CHITTY_TRACK_TOKEN environment variable.
 */

import { Hono } from "hono";
import { requireServiceToken } from "../../middleware/require-service-token.js";

const chittytrackRoutes = new Hono();
chittytrackRoutes.use("*", requireServiceToken("chittytrack"));

const TRACK_URL = "https://track.chitty.cc";

async function proxyGet(c, path) {
  const serviceToken = c.get("serviceToken");

  const url = new URL(path, TRACK_URL);
  for (const [k, v] of Object.entries(c.req.query())) {
    url.searchParams.set(k, v);
  }

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${serviceToken}` },
  });

  if (!response.ok) {
    const errorText = await response.text();
    return c.json(
      { error: `ChittyTrack: ${response.status} - ${errorText}` },
      response.status,
    );
  }

  return c.json(await response.json());
}

/**
 * GET /api/chittytrack/workers
 * List tracked workers and last-seen timestamps
 */
chittytrackRoutes.get("/workers", (c) => proxyGet(c, "/api/v1/workers"));

/**
 * GET /api/chittytrack/errors
 * Recent errors (filter by ?worker=&date=&limit=)
 */
chittytrackRoutes.get("/errors", (c) => proxyGet(c, "/api/v1/errors"));

/**
 * GET /api/chittytrack/stats
 * Aggregate stats across all workers
 */
chittytrackRoutes.get("/stats", (c) => proxyGet(c, "/api/v1/stats"));

export { chittytrackRoutes };
