/**
 * Services Status Scenario Tests
 *
 * Validates the /api/services/status proxy that health-checks
 * all 18 ChittyOS services.
 *
 * Response shape: { services: { [serviceId]: { serviceId, name, url, status, statusCode, lastChecked } } }
 */

import { describe, it, expect } from "vitest";
import { authFetch } from "./config.js";

describe("services status", () => {
  it("GET /api/services/status returns services object", async () => {
    const res = await authFetch("/api/services/status");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.services).toBeDefined();
    expect(typeof body.services).toBe("object");

    const ids = Object.keys(body.services);
    expect(ids.length).toBeGreaterThanOrEqual(1);
  });

  it("each service has required fields", async () => {
    const res = await authFetch("/api/services/status");
    const { services } = await res.json();

    for (const [id, svc] of Object.entries(services)) {
      expect(svc.serviceId).toBe(id);
      expect(svc.name).toBeDefined();
      expect(svc.url).toBeDefined();
      expect(svc.status).toBeDefined();
      expect(["healthy", "degraded", "down"]).toContain(svc.status);
    }
  });

  it("includes chittyid service", async () => {
    const res = await authFetch("/api/services/status");
    const { services } = await res.json();
    expect(services.chittyid).toBeDefined();
    expect(services.chittyid.url).toBe("https://id.chitty.cc");
  });

  it("includes chittyauth service", async () => {
    const res = await authFetch("/api/services/status");
    const { services } = await res.json();
    expect(services.chittyauth).toBeDefined();
    expect(services.chittyauth.url).toBe("https://auth.chitty.cc");
  });
});
