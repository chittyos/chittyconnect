import { describe, it, expect } from "vitest";
import {
  VALID_ENTITY_TYPES,
  VALID_SUBTYPES_BY_ENTITY,
  validateEntityEnvelope,
  validateRegistrationEnvelope,
} from "../../src/lib/registry-entity-envelope.js";

describe("registry entity envelope — canonical P/L/T/E/A contract", () => {
  it("carries all five canonical entity types", () => {
    // @canon: chittycanon://gov/governance#core-types
    expect(VALID_ENTITY_TYPES.sort()).toEqual(["A", "E", "L", "P", "T"]);
    for (const t of VALID_ENTITY_TYPES) {
      expect(VALID_SUBTYPES_BY_ENTITY[t]).toBeDefined();
      expect(VALID_SUBTYPES_BY_ENTITY[t].length).toBeGreaterThan(0);
    }
  });

  it("rejects an unknown entity_type", () => {
    const { errors } = validateEntityEnvelope({ entity_type: "PEO", name: "x" });
    expect(errors.some((e) => e.includes("entity_type must be one of P/L/T/E/A"))).toBe(true);
  });

  it("rejects a subtype not valid for its entity_type", () => {
    const { errors } = validateEntityEnvelope({ entity_type: "T", subtype: "natural" });
    expect(errors.some((e) => e.includes("not valid for entity_type"))).toBe(true);
  });

  it("defaults entity_type to T/service when omitted (backwards compat)", () => {
    const { entityType, subtype, errors } = validateEntityEnvelope({ name: "chittywidget" });
    expect(entityType).toBe("T");
    expect(subtype).toBe("service");
    expect(errors).toEqual([]);
  });

  it("requires entity_type=P for agent-like subtypes — Claude contexts are Person, not Thing", () => {
    const { errors } = validateEntityEnvelope({ entity_type: "T", subtype: "agent" });
    expect(errors.some((e) => e.includes("requires entity_type='P'"))).toBe(true);
  });

  it("accepts a well-formed T/skill envelope at the envelope layer", () => {
    const result = validateRegistrationEnvelope({
      entity_type: "T",
      subtype: "skill",
      name: "chitty-widget-skill",
      description: "does widget things",
      metadata: { maintainer: "nick@nevershitty.com" },
      triggers: ["widget"],
      repository: "https://github.com/CHITTYOS/chitty-widget-skill",
    });
    expect(result.valid).toBe(true);
    expect(result.entityType).toBe("T");
    expect(result.subtype).toBe("skill");
  });

  it("rejects a T/service envelope missing required service fields", () => {
    const result = validateRegistrationEnvelope({
      entity_type: "T",
      name: "chittywidget",
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("version is required"),
        expect.stringContaining("endpoints are required"),
        expect.stringContaining("schema is required"),
      ]),
    );
  });

  it("rejects self-declared trust on an agent submission", () => {
    const result = validateRegistrationEnvelope({
      entity_type: "P",
      subtype: "agent",
      name: "chitty-widget-agent",
      description: "widget agent",
      metadata: { maintainer: "nick@nevershitty.com" },
      entity_class: "Agent",
      capability: "ChittyWidget",
      owns: ["widget-provisioning"],
      trust_score: 99,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("trust is not self-declared"))).toBe(true);
  });

  it("rejects a non-object submission", () => {
    const result = validateRegistrationEnvelope(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/must be a JSON object/);
  });
});

// Live drift check: chittyregister's own /api/v1/requirements is the
// authoritative source for the subtype contract. This module is a MIRROR
// (see file header) — if chittyregister's live contract has moved and this
// mirror hasn't been updated, that's a real bug this test should catch.
// Gated because it depends on live network reachability, not because it's
// non-deterministic.
const RUN_LIVE = process.env.RUN_LIVE_CONTRACT_TESTS === "1";
const maybeIt = RUN_LIVE ? it : it.skip;

describe("registry entity envelope — live drift check against chittyregister", () => {
  // /api/v1/onboard is chittyregister's machine-readable onboarding SOP and
  // is the endpoint that actually enumerates `canonical_entity_types` (unlike
  // /api/v1/requirements, which only covers the legacy T/service profile).
  maybeIt("register.chitty.cc/api/v1/onboard reports canonical_entity_types = P/L/T/E/A", async () => {
    const resp = await fetch("https://register.chitty.cc/api/v1/onboard");
    expect(resp.ok).toBe(true);
    const body = await resp.json();
    expect(Array.isArray(body.canonical_entity_types)).toBe(true);
    expect(body.canonical_entity_types.slice().sort()).toEqual(VALID_ENTITY_TYPES.slice().sort());
    expect(body.canon_ref).toBe("chittycanon://gov/governance#core-types");
  });
});
