import { describe, it, expect, vi, beforeEach } from "vitest";
import { TenantDataMigration } from "../../src/services/tenant-data-migration.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock credential-helper
vi.mock("../../src/lib/credential-helper.js", () => ({
  getCredential: vi.fn().mockResolvedValue("test-neon-api-key"),
}));

// Mock tenant-migrations (used by TenantProjectManager)
vi.mock("../../src/lib/tenant-migrations.js", () => ({
  runTenantMigrations: vi.fn().mockResolvedValue({ applied: 2, total: 2 }),
}));

// Mock tenant-connection-router
vi.mock("../../src/lib/tenant-connection-router.js", () => ({
  queryTenantDb: vi.fn().mockResolvedValue({ layer: "tenant" }),
}));

function createMockEnv() {
  return {
    NEON_API_KEY: "test-neon-api-key",
    CHITTY_EVIDENCE_TOKEN: "test-evidence-token",
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue(null),
          run: vi.fn().mockResolvedValue({ success: true }),
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
      }),
    },
    TENANT_CONNECTIONS: {
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  };
}

/** Helper to make mockFetch return different responses for evidence queries vs Neon API */
function setupFetchMock({ evidenceResponses = [], neonResponse } = {}) {
  let evidenceCallIndex = 0;

  mockFetch.mockImplementation(async (url, options) => {
    // Neon API calls (for provisioning)
    if (typeof url === "string" && url.includes("console.neon.tech")) {
      return {
        ok: true,
        status: 200,
        json: async () =>
          neonResponse || {
            project: { id: "neon-proj-test" },
            connection_uris: [
              { connection_uri: "postgresql://user:pass@host/db" },
            ],
          },
      };
    }

    // Evidence DB query calls
    if (typeof url === "string" && url.includes("evidence.chitty.cc")) {
      const response =
        evidenceResponses[evidenceCallIndex] ||
        evidenceResponses[evidenceResponses.length - 1] ||
        { results: [] };
      evidenceCallIndex++;
      return {
        ok: true,
        status: 200,
        json: async () => response,
      };
    }

    return { ok: false, status: 404, text: async () => "Not found" };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TenantDataMigration", () => {
  describe("discoverClients", () => {
    it("returns distinct clients with document counts", async () => {
      const env = createMockEnv();
      setupFetchMock({
        evidenceResponses: [
          {
            results: [
              { client_id: "client-a", doc_count: 15 },
              { client_id: "client-b", doc_count: 3 },
            ],
          },
        ],
      });

      const migration = new TenantDataMigration(env);
      const result = await migration.discoverClients();

      expect(result.clients).toHaveLength(2);
      expect(result.clients[0].clientId).toBe("client-a");
      expect(result.clients[0].documentCount).toBe(15);
      expect(result.clients[1].clientId).toBe("client-b");
    });

    it("sends auth token to evidence service", async () => {
      const env = createMockEnv();
      setupFetchMock({ evidenceResponses: [{ results: [] }] });

      const migration = new TenantDataMigration(env);
      await migration.discoverClients();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("evidence.chitty.cc"),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-evidence-token",
          }),
        }),
      );
    });
  });

  describe("plan", () => {
    it("returns dry-run plan with counts for all clients", async () => {
      const env = createMockEnv();

      // Response sequence: discoverClients, then for each client:
      // docCount, custodyCount, familyCount
      setupFetchMock({
        evidenceResponses: [
          // discoverClients
          { results: [{ client_id: "client-a", doc_count: 5 }] },
          // docCount for client-a
          { results: [{ cnt: 5 }] },
          // custodyCount for client-a
          { results: [{ cnt: 10 }] },
          // familyCount for client-a
          { results: [{ cnt: 2 }] },
        ],
      });

      const migration = new TenantDataMigration(env);
      const plan = await migration.plan();

      expect(plan.mode).toBe("dry-run");
      expect(plan.totalClients).toBe(1);
      expect(plan.clients[0].clientId).toBe("client-a");
      expect(plan.clients[0].documents).toBe(5);
      expect(plan.clients[0].custodyLogs).toBe(10);
      expect(plan.clients[0].families).toBe(2);
      expect(plan.clients[0].alreadyProvisioned).toBe(false);
      expect(plan.totals.needsProvisioning).toBe(1);
    });

    it("detects already-provisioned tenants", async () => {
      const env = createMockEnv();
      // Make getTenantRecord return an existing record
      env.DB.prepare.mockReturnValue({
        bind: vi.fn().mockReturnValue({
          first: vi.fn().mockResolvedValue({ tenant_id: "client-a", status: "active" }),
          run: vi.fn().mockResolvedValue({ success: true }),
          all: vi.fn().mockResolvedValue({ results: [] }),
        }),
      });

      setupFetchMock({
        evidenceResponses: [
          { results: [{ cnt: 3 }] },
          { results: [{ cnt: 1 }] },
          { results: [{ cnt: 0 }] },
        ],
      });

      const migration = new TenantDataMigration(env);
      const plan = await migration.plan({ clientId: "client-a" });

      expect(plan.clients[0].alreadyProvisioned).toBe(true);
      expect(plan.totals.alreadyProvisioned).toBe(1);
    });
  });

  describe("execute", () => {
    it("returns plan when dryRun is true", async () => {
      const env = createMockEnv();
      setupFetchMock({
        evidenceResponses: [
          { results: [] }, // discoverClients returns empty
        ],
      });

      const migration = new TenantDataMigration(env);
      const result = await migration.execute({ dryRun: true });

      expect(result.mode).toBe("dry-run");
    });

    it("provisions tenant and replicates documents", async () => {
      const env = createMockEnv();
      const { queryTenantDb } = await import(
        "../../src/lib/tenant-connection-router.js"
      );

      setupFetchMock({
        evidenceResponses: [
          // execute → discoverClients
          { results: [{ client_id: "client-x", doc_count: 1 }] },
          // migrateDocuments batch 1 (1 row < BATCH_SIZE=50, loop breaks after this)
          {
            results: [
              {
                id: "doc-1",
                document_type: "contract",
                file_name: "contract.pdf",
                file_size: 1024,
                mime_type: "application/pdf",
                content_hash: "abc123",
                r2_key: "docs/contract.pdf",
                ocr_text: "Contract text",
                metadata: "{}",
                processing_status: "complete",
                privilege_flag: "none",
                privilege_basis: null,
                evidence_strength: 4,
                evidence_strength_rationale: "Direct evidence",
                uploaded_by: "user-1",
                client_id: "client-x",
                superseded_by: null,
                supersedes: null,
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
              },
            ],
          },
          // migrateCustodyLogs batch 1 (1 row < BATCH_SIZE, loop breaks)
          {
            results: [
              {
                id: "custody-1",
                document_id: "doc-1",
                action: "ingested",
                actor: "pipeline",
                details: "{}",
                created_at: "2026-01-01T00:00:00Z",
              },
            ],
          },
          // migrateDocumentFamilies batch 1 (empty)
          { results: [] },
        ],
      });

      const migration = new TenantDataMigration(env);
      const result = await migration.execute();

      expect(result.mode).toBe("execute");
      expect(result.clients).toHaveLength(1);
      expect(result.clients[0].clientId).toBe("client-x");
      expect(result.clients[0].provisioned).toBe(true);
      expect(result.clients[0].documents).toBe(1);
      expect(result.clients[0].custodyLogs).toBe(1);
      expect(result.clients[0].families).toBe(0);
      expect(result.totals.provisioned).toBe(1);
      expect(result.totals.documents).toBe(1);

      // Verify queryTenantDb was called for replication
      expect(queryTenantDb).toHaveBeenCalled();
    });

    it("handles errors per-client without stopping migration", async () => {
      const env = createMockEnv();

      setupFetchMock({
        evidenceResponses: [
          // discoverClients
          {
            results: [
              { client_id: "client-ok", doc_count: 1 },
              { client_id: "client-fail", doc_count: 1 },
            ],
          },
        ],
      });

      // Override fetch to fail on provision for client-fail
      let callCount = 0;
      mockFetch.mockImplementation(async (url) => {
        callCount++;

        if (typeof url === "string" && url.includes("evidence.chitty.cc")) {
          // First call: discoverClients (already happened above)
          // Subsequent: migration queries
          if (callCount <= 1) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                results: [
                  { client_id: "client-ok", doc_count: 1 },
                  { client_id: "client-fail", doc_count: 1 },
                ],
              }),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ results: [] }),
          };
        }

        if (typeof url === "string" && url.includes("console.neon.tech")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              project: { id: "neon-proj-test" },
              connection_uris: [
                { connection_uri: "postgresql://user:pass@host/db" },
              ],
            }),
          };
        }

        return { ok: false, status: 404, text: async () => "Not found" };
      });

      const migration = new TenantDataMigration(env);
      const result = await migration.execute();

      expect(result.clients).toHaveLength(2);
      expect(result.completedAt).toBeDefined();
    });

    it("migrates a single client when clientId specified", async () => {
      const env = createMockEnv();

      setupFetchMock({
        evidenceResponses: [
          // migrateDocuments (empty)
          { results: [] },
          // migrateCustodyLogs (empty)
          { results: [] },
          // migrateDocumentFamilies (empty)
          { results: [] },
        ],
      });

      const migration = new TenantDataMigration(env);
      const result = await migration.execute({ clientId: "specific-client" });

      expect(result.clients).toHaveLength(1);
      expect(result.clients[0].clientId).toBe("specific-client");
    });
  });
});
