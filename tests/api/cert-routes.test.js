import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock global fetch for proxy tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import after stubbing fetch
const { certRoutes } = await import("../../src/api/routes/cert.js");

describe("cert proxy routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("POST /verify", () => {
    it("proxies verify request to cert.chitty.cc", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ valid: true, certificate_id: "CERT-001" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const req = new Request("http://localhost/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ certificate_id: "CERT-001" }),
      });

      const res = await certRoutes.fetch(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.valid).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://cert.chitty.cc/api/v1/verify",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("passes upstream error status through", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "certificate_id is required" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const req = new Request("http://localhost/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await certRoutes.fetch(req);
      expect(res.status).toBe(400);
    });

    it("returns 502 on fetch failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Connection refused"));

      const req = new Request("http://localhost/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ certificate_id: "CERT-001" }),
      });

      const res = await certRoutes.fetch(req);
      const body = await res.json();

      expect(res.status).toBe(502);
      expect(body.error).toBe("cert_verify_failed");
    });
  });

  describe("GET /:id", () => {
    it("fetches certificate details from cert.chitty.cc", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: "CERT-001", subject: "chittyconnect", status: "valid" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const req = new Request("http://localhost/CERT-001");
      const res = await certRoutes.fetch(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.id).toBe("CERT-001");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://cert.chitty.cc/api/v1/certificate/CERT-001",
      );
    });

    it("passes 404 from upstream", async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const req = new Request("http://localhost/CERT-NONE");
      const res = await certRoutes.fetch(req);
      expect(res.status).toBe(404);
    });

    it("returns 502 on fetch failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("timeout"));

      const req = new Request("http://localhost/CERT-001");
      const res = await certRoutes.fetch(req);
      const body = await res.json();

      expect(res.status).toBe(502);
      expect(body.error).toBe("cert_fetch_failed");
    });
  });
});
