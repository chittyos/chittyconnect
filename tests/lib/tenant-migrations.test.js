import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  runTenantMigrations,
  TENANT_MIGRATIONS,
} from "../../src/lib/tenant-migrations.js";

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

beforeEach(() => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue(undefined);
  mockEnd.mockResolvedValue(undefined);
});

describe("TENANT_MIGRATIONS", () => {
  it("has sequential version numbers", () => {
    for (let i = 0; i < TENANT_MIGRATIONS.length; i++) {
      expect(TENANT_MIGRATIONS[i].version).toBe(i + 1);
    }
  });

  it("has at least 2 migrations", () => {
    expect(TENANT_MIGRATIONS.length).toBeGreaterThanOrEqual(2);
  });

  it("migration 1 creates evidence_documents", () => {
    expect(TENANT_MIGRATIONS[0].sql).toContain("evidence_documents");
    expect(TENANT_MIGRATIONS[0].sql).toContain("evidence_custody_log");
    expect(TENANT_MIGRATIONS[0].sql).toContain("document_families");
  });

  it("migration 2 creates client_documents and financial_records", () => {
    expect(TENANT_MIGRATIONS[1].sql).toContain("client_documents");
    expect(TENANT_MIGRATIONS[1].sql).toContain("financial_records");
  });
});

describe("runTenantMigrations", () => {
  it("runs all migrations on a fresh database", async () => {
    // Schema version table creation succeeds
    // No existing versions
    mockQuery
      .mockResolvedValueOnce({}) // CREATE _tenant_schema_version
      .mockResolvedValueOnce({ rows: [] }) // SELECT applied versions
      .mockResolvedValueOnce({}) // migration 1 SQL
      .mockResolvedValueOnce({}) // INSERT version 1
      .mockResolvedValueOnce({}) // migration 2 SQL
      .mockResolvedValueOnce({}); // INSERT version 2

    const result = await runTenantMigrations("postgresql://test");

    expect(result.applied).toBe(2);
    expect(result.total).toBe(TENANT_MIGRATIONS.length);
    expect(mockConnect).toHaveBeenCalled();
    expect(mockEnd).toHaveBeenCalled();
  });

  it("skips already-applied migrations", async () => {
    // Version 1 already applied
    mockQuery
      .mockResolvedValueOnce({}) // CREATE _tenant_schema_version
      .mockResolvedValueOnce({ rows: [{ version: 1 }] }) // version 1 exists
      .mockResolvedValueOnce({}) // migration 2 SQL
      .mockResolvedValueOnce({}); // INSERT version 2

    const result = await runTenantMigrations("postgresql://test");

    expect(result.applied).toBe(1);
  });

  it("returns zero applied when all are current", async () => {
    mockQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({
        rows: [{ version: 1 }, { version: 2 }],
      });

    const result = await runTenantMigrations("postgresql://test");

    expect(result.applied).toBe(0);
    expect(result.total).toBe(TENANT_MIGRATIONS.length);
  });

  it("always closes the client connection", async () => {
    mockQuery.mockRejectedValueOnce(new Error("connection failed"));

    await expect(
      runTenantMigrations("postgresql://test"),
    ).rejects.toThrow("connection failed");

    expect(mockEnd).toHaveBeenCalled();
  });
});
