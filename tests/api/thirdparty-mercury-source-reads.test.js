import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildMercuryReadQuery,
  resolveMercuryReadReference,
} from "../../src/api/routes/thirdparty.js";

const uuid = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const url = (surface, params = "") =>
  `https://connect.chitty.cc/api/thirdparty/mercury/${surface}?${params}`;

describe("Mercury source-only read query forwarding", () => {
  it("passes Events cursors and resource selectors without forwarding the credential projection", () => {
    expect(buildMercuryReadQuery(
      url("events", `slug=FC&limit=50&order=asc&start_after=${uuid}&resourceType=transaction&resourceId=${uuid}`),
      "events",
    )).toBe(`?limit=50&order=asc&start_after=${uuid}&resourceType=transaction&resourceId=${uuid}`);
  });

  it("preserves webhook status filters and cursor, omitting credential labels", () => {
    expect(buildMercuryReadQuery(
      url("webhooks", `entity=CHIT&status=active&status=paused&start_after=${uuid}`),
      "webhooks",
    )).toBe(`?status=active&status=paused&start_after=${uuid}`);
  });

  it("forwards posted date filters, pending state, and pagination for local finance coverage validation", () => {
    expect(buildMercuryReadQuery(
      url("transactions", `slug=CITY&postedStart=2026-10-08&status=pending&limit=1000&start_after=${uuid}`),
      "transactions",
    )).toBe(`?postedStart=2026-10-08&status=pending&limit=1000&start_after=${uuid}`);
  });

  it("rejects unsupported source query fields, mutually exclusive cursors, and invalid values", () => {
    const bad = [
      ["events", "x=1"],
      ["events", "limit=0"],
      ["events", "start_after=not-uuid"],
      ["events", `start_after=${uuid}&end_before=${uuid}`],
      ["events", "resourceType=bank"],
      ["webhooks", "status=running"],
      ["transactions", "postedStart=not-a-date"],
      ["transactions", "status=settled"],
      ["transactions", "order=newest"],
      ["transactions", "limit=1001"],
    ];
    for (const [surface, params] of bad) {
      expect(() => buildMercuryReadQuery(url(surface, params), surface)).toThrow();
    }
  });

  it("never uses a guessed credential alias or technical tenant as provider identity", () => {
    for (const bad of ["APTA", "tenant_id", "constructor", "__proto__"]) {
      expect(() => resolveMercuryReadReference(bad)).toThrow();
    }
  });
});

describe("Mercury activity-gate route containment", () => {
  const file = readFileSync(new URL("../../src/api/routes/thirdparty.js", import.meta.url), "utf8");
  it("exposes source-only GET routes for organization, Events, webhooks, and transactions", () => {
    for (const route of ["organization", "events", "webhooks", "transactions"]) {
      expect(file).toContain(`"/mercury/${route}"`);
    }
    expect(file).toContain('requireMercuryCredential');
    expect(file).toContain('brokerMercuryFetch');
  });

  it("adds no direct finance ledger write or database access to source read routes", () => {
    const start = file.indexOf("const MERCURY_READ_FILTERS");
    const end = file.indexOf("/** GET /api/thirdparty/mercury/accounts */", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const excerpt = file.slice(start, end);
    expect(excerpt).not.toMatch(/SVC_FINANCE|HYPERDRIVE|postgres|Neon|INSERT INTO|UPDATE transactions/);
    expect(excerpt).toMatch(/\/events/);
    expect(excerpt).toMatch(/\/webhooks/);
  });
});
