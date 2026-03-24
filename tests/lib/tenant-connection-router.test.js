import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  queryTenantDb,
  resolveDataLayer,
} from "../../src/lib/tenant-connection-router.js";

// Mock the Client from @neondatabase/serverless
const mockConnect = vi.fn();
const mockQuery = vi.fn();
const mockEnd = vi.fn();

vi.mock("@neondatabase/serverless", () => ({
  Client: class MockClient {
    constructor() {
      this.connect = mockConnect;
      this.query = mockQuery;
      this.end = mockEnd;
    }
  },
}));

// Mock TenantProjectManager
vi.mock("../../src/services/tenant-project-manager.js", () => ({
  TenantProjectManager: class MockTPM {
    getTenantConnection() {
      return Promise.resolve(null);
    }
  },
}));

// Mock credential-helper
vi.mock("../../src/lib/credential-helper.js", () => ({
  getCredential: vi.fn().mockResolvedValue("postgresql://platform-db"),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue(undefined);
  mockEnd.mockResolvedValue(undefined);
});

describe("resolveDataLayer", () => {
  it("routes work_product to platform", () => {
    expect(resolveDataLayer("work_product")).toBe("platform");
  });

  it("routes none to tenant", () => {
    expect(resolveDataLayer("none")).toBe("tenant");
  });

  it("routes possible_ac to tenant", () => {
    expect(resolveDataLayer("possible_ac")).toBe("tenant");
  });

  it("routes needs_review to tenant", () => {
    expect(resolveDataLayer("needs_review")).toBe("tenant");
  });
});

describe("queryTenantDb", () => {
  it("executes query and returns rows with layer info", async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 1, name: "test" }] });

    const env = { NEON_DATABASE_URL: "postgresql://platform-db" };
    const result = await queryTenantDb(env, "tenant-1", "SELECT * FROM t", []);

    expect(result.rows).toEqual([{ id: 1, name: "test" }]);
    expect(result.layer).toBe("platform"); // Falls back to platform since mock returns null
    expect(mockConnect).toHaveBeenCalled();
    expect(mockEnd).toHaveBeenCalled();
  });

  it("always closes the client connection", async () => {
    mockQuery.mockRejectedValue(new Error("query failed"));

    const env = { NEON_DATABASE_URL: "postgresql://platform-db" };
    await expect(
      queryTenantDb(env, "tenant-1", "BAD SQL", []),
    ).rejects.toThrow("query failed");

    expect(mockEnd).toHaveBeenCalled();
  });
});
