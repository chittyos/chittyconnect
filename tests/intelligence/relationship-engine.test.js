import { describe, it, expect } from "vitest";
import { RelationshipEngine } from "../../src/intelligence/relationship-engine.js";

class MockStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    return this.db.handleFirst(this.sql, this.args);
  }

  async all() {
    return this.db.handleAll(this.sql, this.args);
  }
}

class MockDB {
  prepare(sql) {
    return new MockStatement(this, sql);
  }

  async handleFirst(sql, args) {
    if (sql.includes("WHERE ce.chitty_id = ?")) {
      if (args[0] !== "ctx-main") return null;
      return {
        id: "1",
        chitty_id: "ctx-main",
        status: "active",
        project_path: "/repo/main",
        workspace: "ws-a",
        support_type: "development",
        organization: "ChittyOS",
        trust_level: 4,
        competencies: JSON.stringify(["typescript", "cloudflare", "ai"]),
        expertise_domains: JSON.stringify(["backend-development", "ai-development"]),
        patterns: JSON.stringify([{ type: "deploy" }, { type: "analyze" }]),
      };
    }

    if (sql.includes("COUNT(*) as count FROM context_entities")) {
      return { count: 3 };
    }
    if (sql.includes("COUNT(*) as count FROM context_exposure_log")) {
      return { count: 20 };
    }
    if (sql.includes("COUNT(*) as count FROM context_behavioral_events")) {
      return { count: 12 };
    }

    return null;
  }

  async handleAll(sql) {
    if (sql.includes("FROM context_entities ce") && sql.includes("ce.status IN ('active', 'dormant')")) {
      return {
        results: [
          {
            chitty_id: "ctx-peer-1",
            project_path: "/repo/main",
            workspace: "ws-a",
            support_type: "development",
            organization: "ChittyOS",
            trust_level: 4,
            competencies: JSON.stringify(["typescript", "cloudflare"]),
            expertise_domains: JSON.stringify(["backend-development"]),
            patterns: JSON.stringify([{ type: "deploy" }]),
          },
          {
            chitty_id: "ctx-peer-2",
            project_path: "/repo/other",
            workspace: "ws-b",
            support_type: "research",
            organization: "OtherOrg",
            trust_level: 2,
            competencies: JSON.stringify(["legal"]),
            expertise_domains: JSON.stringify(["legal"]),
            patterns: JSON.stringify([{ type: "draft" }]),
          },
        ],
      };
    }

    if (
      sql.includes("FROM context_behavioral_events") &&
      sql.includes("WHERE context_chitty_id = ?") &&
      !sql.includes("JOIN context_behavioral_events other")
    ) {
      return {
        results: [
          { event_type: "trait_shift", detected_at: 1700000000 },
          { event_type: "trait_shift", detected_at: 1700001800 },
        ],
      };
    }

    if (sql.includes("JOIN context_behavioral_events other")) {
      return {
        results: [
          { chitty_id: "ctx-peer-1", overlap_count: 2, last_overlap_at: 1700001900 },
        ],
      };
    }

    if (
      sql.includes("FROM context_exposure_log") &&
      sql.includes("WHERE context_chitty_id = ?") &&
      !sql.includes("source_domain IN")
    ) {
      return {
        results: [
          { source_domain: "github.com", count: 5 },
          { source_domain: "docs.github.com", count: 3 },
        ],
      };
    }

    if (sql.includes("source_domain IN")) {
      return {
        results: [
          { chitty_id: "ctx-peer-1", source_domain: "github.com", count: 4 },
          { chitty_id: "ctx-peer-1", source_domain: "docs.github.com", count: 2 },
          { chitty_id: "ctx-peer-3", source_domain: "github.com", count: 1 },
        ],
      };
    }

    return { results: [] };
  }
}

describe("RelationshipEngine", () => {
  it("discovers and scores relationships across multiple dimensions", async () => {
    const engine = new RelationshipEngine({ DB: new MockDB() });
    await engine.initialize();

    const result = await engine.discoverRelationships("ctx-main", {
      limit: 10,
      includeSummary: false,
    });

    expect(result.entity.chitty_id).toBe("ctx-main");
    expect(result.direct.length).toBeGreaterThan(0);
    expect(result.inferred.length).toBeGreaterThan(0);
    expect(result.temporal.length).toBeGreaterThan(0);
    expect(result.contextual.length).toBeGreaterThan(0);
    expect(result.strength.score).toBeGreaterThan(0);
  });

  it("returns health metrics from backing tables", async () => {
    const engine = new RelationshipEngine({ DB: new MockDB() });
    const health = await engine.getHealth();

    expect(health.available).toBe(true);
    expect(health.indexedEntities).toBe(3);
    expect(health.exposureRecords).toBe(20);
    expect(health.behavioralEvents).toBe(12);
  });

  it("throws when the target entity does not exist", async () => {
    const engine = new RelationshipEngine({ DB: new MockDB() });
    await expect(engine.discoverRelationships("missing-context")).rejects.toThrow(
      "Entity not found",
    );
  });
});
