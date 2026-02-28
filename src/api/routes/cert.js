/**
 * Certificate proxy routes
 *
 * Passthrough to ChittyCertify at cert.chitty.cc for
 * certificate verification and retrieval.
 */

import { Hono } from "hono";

const CERTIFY_BASE = "https://cert.chitty.cc";

const certRoutes = new Hono();

/**
 * POST /api/v1/cert/verify
 * Verify a certificate via ChittyCertify
 */
certRoutes.post("/verify", async (c) => {
  try {
    const body = await c.req.json();
    const resp = await fetch(`${CERTIFY_BASE}/api/v1/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    return c.json(data, resp.status);
  } catch (error) {
    return c.json(
      { error: "cert_verify_failed", message: error.message },
      502,
    );
  }
});

/**
 * GET /api/v1/cert/:id
 * Fetch certificate details from ChittyCertify
 */
certRoutes.get("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const resp = await fetch(`${CERTIFY_BASE}/api/v1/certificate/${id}`);
    const data = await resp.json();
    return c.json(data, resp.status);
  } catch (error) {
    return c.json(
      { error: "cert_fetch_failed", message: error.message },
      502,
    );
  }
});

export { certRoutes };
