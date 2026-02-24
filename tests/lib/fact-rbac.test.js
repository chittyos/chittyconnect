// tests/lib/fact-rbac.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkFactPermission, FACT_ACTIONS } from "../../src/lib/fact-rbac.js";

vi.mock("../../src/lib/trust-resolver.js", () => ({
  resolveTrustLevel: vi.fn(),
  TRUST_LEVELS: { ANONYMOUS: 0, BASIC: 1, ENHANCED: 2, PROFESSIONAL: 3, INSTITUTIONAL: 4, OFFICIAL: 5 },
}));

import { resolveTrustLevel } from "../../src/lib/trust-resolver.js";

const mockEnv = {};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FACT_ACTIONS", () => {
  it("defines all governance actions", () => {
    expect(FACT_ACTIONS.SEAL).toBeDefined();
    expect(FACT_ACTIONS.DISPUTE).toBeDefined();
    expect(FACT_ACTIONS.EXPORT).toBeDefined();
  });
});

describe("checkFactPermission", () => {
  it("allows seal when entity is Authority with INSTITUTIONAL trust", async () => {
    resolveTrustLevel.mockResolvedValue({ trust_level: 4, entity_type: "A" });

    const result = await checkFactPermission("chitty-id", FACT_ACTIONS.SEAL, mockEnv);

    expect(result.allowed).toBe(true);
  });

  it("denies seal when entity is Person (wrong entity type)", async () => {
    resolveTrustLevel.mockResolvedValue({ trust_level: 5, entity_type: "P" });

    const result = await checkFactPermission("chitty-id", FACT_ACTIONS.SEAL, mockEnv);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("entity type");
  });

  it("denies seal when trust level too low", async () => {
    resolveTrustLevel.mockResolvedValue({ trust_level: 3, entity_type: "A" });

    const result = await checkFactPermission("chitty-id", FACT_ACTIONS.SEAL, mockEnv);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("trust level");
  });

  it("allows dispute for Person with ENHANCED trust", async () => {
    resolveTrustLevel.mockResolvedValue({ trust_level: 2, entity_type: "P" });

    const result = await checkFactPermission("chitty-id", FACT_ACTIONS.DISPUTE, mockEnv);

    expect(result.allowed).toBe(true);
  });

  it("allows export for any authenticated entity with BASIC trust", async () => {
    resolveTrustLevel.mockResolvedValue({ trust_level: 1, entity_type: "T" });

    const result = await checkFactPermission("chitty-id", FACT_ACTIONS.EXPORT, mockEnv);

    expect(result.allowed).toBe(true);
  });

  it("returns full context on denial", async () => {
    resolveTrustLevel.mockResolvedValue({ trust_level: 0, entity_type: "P" });

    const result = await checkFactPermission("chitty-id", FACT_ACTIONS.DISPUTE, mockEnv);

    expect(result.allowed).toBe(false);
    expect(result.trust_level).toBe(0);
    expect(result.required_level).toBe(2);
    expect(result.action).toBe("dispute");
  });
});
