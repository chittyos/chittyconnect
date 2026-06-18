/**
 * Health Check Scenario Tests
 *
 * Smoke tests against live endpoints.
 * Root-level endpoints don't require auth; /api/* endpoints do.
 */

import { describe, it, expect } from "vitest";
import { BASE_URL, authFetch } from "./config.js";

describe("health checks", () => {
  it("GET /health returns healthy status", async () => {
    const res = await fetch(`${BASE_URL}/health`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" } });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("chittyconnect");
    expect(body.version).toBeDefined();
  });

  it("GET /api/health returns 200 with JSON (requires auth)", async () => {
    const res = await authFetch("/api/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("healthy");
  });

  it("GET /intelligence/health returns 200 with modules", async () => {
    const res = await fetch(`${BASE_URL}/intelligence/health`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" } });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.modules).toBeDefined();
  });

  it("GET /sse/health returns 200", async () => {
    const res = await fetch(`${BASE_URL}/sse/health`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" } });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBeDefined();
  });

  it("GET /openapi.json returns valid OpenAPI 3.1 spec", async () => {
    const res = await fetch(`${BASE_URL}/openapi.json`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" } });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.openapi).toBe("3.1.0");
  });

  it("GET /.well-known/chitty.json returns discovery document", async () => {
    const res = await fetch(`${BASE_URL}/.well-known/chitty.json`, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" } });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ecosystem).toBe("ChittyOS");
    expect(body.endpoints).toBeDefined();
    expect(body.capabilities).toBeDefined();
  });
});
