import { describe, it, expect } from "vitest";
import { getAllowedOrigin, corsHeaders } from "../../src/lib/cors.js";

describe("CORS origin validation", () => {
  it("allows *.chitty.cc origins", () => {
    expect(getAllowedOrigin("https://connect.chitty.cc")).toBe("https://connect.chitty.cc");
    expect(getAllowedOrigin("https://dashboard.chitty.cc")).toBe("https://dashboard.chitty.cc");
    expect(getAllowedOrigin("https://mcp.chitty.cc")).toBe("https://mcp.chitty.cc");
  });

  it("allows localhost origins", () => {
    expect(getAllowedOrigin("http://localhost:5173")).toBe("http://localhost:5173");
    expect(getAllowedOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(getAllowedOrigin("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
  });

  it("allows ChatGPT origins", () => {
    expect(getAllowedOrigin("https://chat.openai.com")).toBe("https://chat.openai.com");
    expect(getAllowedOrigin("https://chatgpt.com")).toBe("https://chatgpt.com");
  });

  it("allows Cloudflare Pages preview origins", () => {
    expect(getAllowedOrigin("https://chittyconnect-ui.pages.dev")).toBe("https://chittyconnect-ui.pages.dev");
    expect(getAllowedOrigin("https://abc123.chittyconnect-ui.pages.dev")).toBe("https://abc123.chittyconnect-ui.pages.dev");
  });

  it("rejects HTTP for production domains", () => {
    expect(getAllowedOrigin("http://connect.chitty.cc")).toBeNull();
    expect(getAllowedOrigin("http://chatgpt.com")).toBeNull();
  });

  it("rejects unknown origins", () => {
    expect(getAllowedOrigin("https://evil.com")).toBeNull();
    expect(getAllowedOrigin("https://not-chitty.cc")).toBeNull();
    expect(getAllowedOrigin("https://chitty.cc.evil.com")).toBeNull();
  });

  it("handles null/undefined origin", () => {
    expect(getAllowedOrigin(null)).toBeNull();
    expect(getAllowedOrigin(undefined)).toBeNull();
  });

  it("corsHeaders includes origin when allowed", () => {
    const req = new Request("https://connect.chitty.cc/health", {
      headers: { Origin: "https://dashboard.chitty.cc" },
    });
    const headers = corsHeaders(req);
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://dashboard.chitty.cc");
    expect(headers["Access-Control-Allow-Methods"]).toContain("GET");
    expect(headers.Vary).toBe("Origin");
  });

  it("corsHeaders omits origin when disallowed", () => {
    const req = new Request("https://connect.chitty.cc/health", {
      headers: { Origin: "https://evil.com" },
    });
    const headers = corsHeaders(req);
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});
