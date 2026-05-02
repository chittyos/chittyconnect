import { describe, it, expect } from "vitest";
import {
  getServiceCatalog,
  getServiceUrl,
} from "../../src/lib/service-catalog.js";

describe("getServiceCatalog", () => {
  it("returns all services with default domain", () => {
    const catalog = getServiceCatalog({});
    expect(catalog.length).toBe(20);
    expect(catalog[0]).toHaveProperty("id");
    expect(catalog[0]).toHaveProperty("url");
    expect(catalog[0].url).toMatch(/^https:\/\/.+\.chitty\.cc$/);
  });

  it("uses custom domain from env", () => {
    const catalog = getServiceCatalog({ CHITTYOS_DOMAIN: "example.com" });
    expect(catalog[0].url).toMatch(/\.example\.com$/);
  });

  it("handles undefined env gracefully", () => {
    const catalog = getServiceCatalog();
    expect(catalog.length).toBeGreaterThan(0);
    expect(catalog[0].url).toMatch(/\.chitty\.cc$/);
  });

  it("includes known services", () => {
    const catalog = getServiceCatalog({});
    const ids = catalog.map((s) => s.id);
    expect(ids).toContain("chittyid");
    expect(ids).toContain("chittychronicle");
    expect(ids).toContain("chittyevidence");
  });
});

describe("getServiceUrl", () => {
  it("returns URL for known service", () => {
    expect(getServiceUrl({}, "chittyid")).toBe("https://id.chitty.cc");
  });

  it("returns null for unknown service", () => {
    expect(getServiceUrl({}, "nonexistent")).toBeNull();
  });

  it("resolves non-obvious subdomain mappings", () => {
    expect(getServiceUrl({}, "chittytask")).toBe("https://tasks.chitty.cc");
    expect(getServiceUrl({}, "chittycases")).toBe("https://cases.chitty.cc");
  });

  it("uses custom domain", () => {
    expect(
      getServiceUrl({ CHITTYOS_DOMAIN: "test.cc" }, "chittychronicle"),
    ).toBe("https://chronicle.test.cc");
  });

  it("handles undefined env gracefully", () => {
    expect(getServiceUrl(undefined, "chittyid")).toBe(
      "https://id.chitty.cc",
    );
  });
});
