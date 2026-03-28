/**
 * ChittyAuth API Routes
 * Authentication and authorization with 1Password Connect integration
 *
 * Service token retrieved dynamically from 1Password with automatic
 * failover to environment variables if 1Password Connect is unavailable.
 */

import { Hono } from "hono";
import { requireServiceToken } from "../../middleware/require-service-token.js";

const chittyauthRoutes = new Hono();
chittyauthRoutes.use("*", requireServiceToken("chittyauth"));

/**
 * POST /api/chittyauth/verify
 * Verify authentication token
 */
chittyauthRoutes.post("/verify", async (c) => {
  try {
    const { token } = await c.req.json();

    if (!token) {
      return c.json({ error: "token is required" }, 400);
    }

    const serviceToken = c.get("serviceToken");

    const response = await fetch("https://auth.chitty.cc/api/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({ token }),
    });

    if (!response.ok) {
      throw new Error(`ChittyAuth service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

/**
 * POST /api/chittyauth/refresh
 * Refresh access token
 */
chittyauthRoutes.post("/refresh", async (c) => {
  try {
    const { refreshToken } = await c.req.json();

    if (!refreshToken) {
      return c.json({ error: "refreshToken is required" }, 400);
    }

    const serviceToken = c.get("serviceToken");

    const response = await fetch("https://auth.chitty.cc/api/refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceToken}`,
      },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      throw new Error(`ChittyAuth service error: ${response.status}`);
    }

    const data = await response.json();
    return c.json(data);
  } catch (error) {
    return c.json({ error: error.message }, 500);
  }
});

export { chittyauthRoutes };
