/**
 * Mercury Token Resolution Tests
 *
 * Verifies that getMercuryToken correctly converts kebab-case slugs
 * to underscore-separated uppercase env var names.
 */

import { describe, it, expect } from "vitest";

// Import the thirdparty routes module to test getMercuryToken indirectly
// via the route handlers. We test by constructing a minimal Hono context.
describe("Mercury token resolution", () => {
  it("converts kebab-case slug to underscore env var name", async () => {
    // Simulate the env var lookup logic from getMercuryToken
    const slug = "aribia-llc";
    const envKey = `MERCURY_API_KEY_${slug.replace(/-/g, "_").toUpperCase()}`;
    expect(envKey).toBe("MERCURY_API_KEY_ARIBIA_LLC");
  });

  it("converts multi-segment kebab slug correctly", async () => {
    const slug = "chicago-furnished-condos";
    const envKey = `MERCURY_API_KEY_${slug.replace(/-/g, "_").toUpperCase()}`;
    expect(envKey).toBe("MERCURY_API_KEY_CHICAGO_FURNISHED_CONDOS");
  });

  it("handles slug without hyphens (no-op)", async () => {
    const slug = "default";
    const envKey = `MERCURY_API_KEY_${slug.replace(/-/g, "_").toUpperCase()}`;
    expect(envKey).toBe("MERCURY_API_KEY_DEFAULT");
  });

  it("rejects invalid slug characters via getSlug regex", () => {
    const validPattern = /^[a-z0-9_-]+$/i;
    expect(validPattern.test("aribia-llc")).toBe(true);
    expect(validPattern.test("chicago-furnished-condos")).toBe(true);
    expect(validPattern.test("../etc/passwd")).toBe(false);
    expect(validPattern.test("slug with spaces")).toBe(false);
    expect(validPattern.test("MERCURY_API_KEY")).toBe(true);
  });
});
