// Credential resolution tiers and error classes — chittyos/chittyconnect#303.
//
// Real behavior, no module mocks: getCredentialResult reads from the env object
// it is handed, and CloudflareSecretsBroker reads from that same env, so a plain
// object with the mapped binding IS the real backend here. A Secrets Store
// binding is modelled the way the runtime presents one — an object with an async
// .get() — because that shape is the whole point of resolveBindingValue.

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getCredential,
  getCredentialResult,
  getServiceToken,
  getMintAuthToken,
  resolveBindingValue,
  CREDENTIAL_ERROR_CLASS,
} from "../../src/lib/credential-helper.js";

/** Shape the Workers runtime gives a `secrets_store_secrets` binding. */
function storeBinding(value) {
  return { get: async () => value };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveBindingValue", () => {
  it("unwraps a Secrets Store binding rather than returning the object", async () => {
    const binding = storeBinding("resolved-token-value");
    expect(await resolveBindingValue(binding)).toBe("resolved-token-value");
  });

  it("passes a plain managed secret through unchanged", async () => {
    expect(await resolveBindingValue("plain-secret-value")).toBe(
      "plain-secret-value",
    );
  });

  it("returns undefined for an empty binding instead of an empty string", async () => {
    expect(await resolveBindingValue(storeBinding(""))).toBeUndefined();
    expect(await resolveBindingValue(undefined)).toBeUndefined();
  });

  it("rejects a binding whose .get() yields a non-string — the real [object Object] path", async () => {
    // Adversarial review: the previous version of this test passed a plain
    // object, which exits at the `typeof value.get === "function"` check and
    // never exercises the failing case.
    const result = await resolveBindingValue(storeBinding({ nested: "object" }));
    expect(result).toBeUndefined();
  });

  it("ignores a non-binding object", async () => {
    expect(await resolveBindingValue({ notABinding: true })).toBeUndefined();
  });
});

describe("getCredentialResult tiers", () => {
  it("serves from the binding when the broker has nothing, and says so", async () => {
    const env = {
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
      NOTION_TOKEN: "notion-managed-secret",
    };

    const result = await getCredentialResult(
      env,
      "integrations/notion/api_key",
      "NOTION_TOKEN",
      "notion",
    );

    expect(result.value).toBe("notion-managed-secret");
    expect(result.source).toBe("binding");
    expect(result.errorClass).toBeNull();
  });

  it("unwraps a Secrets Store binding served from the hot tier", async () => {
    const env = {
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
      CHITTYAUTH_ISSUED_MINT_API_KEY: storeBinding("mint-key-from-store"),
    };

    const result = await getCredentialResult(
      env,
      "services/chittymint/service_token",
      "CHITTYAUTH_ISSUED_MINT_API_KEY",
      "chittymint",
    );

    expect(result.value).toBe("mint-key-from-store");
    expect(typeof result.value).toBe("string");
  });

  it("classifies absent-everywhere as MISSING_CREDENTIAL_MATERIAL", async () => {
    const env = { CREDENTIAL_BROKER_TYPE: "cloudflare-secrets" };

    const result = await getCredentialResult(
      env,
      "services/chittycommand/org_automation_token",
      "ORG_AUTOMATION_TOKEN",
      "chittycommand",
    );

    expect(result.value).toBeUndefined();
    expect(result.errorClass).toBe(CREDENTIAL_ERROR_CLASS.MISSING_MATERIAL);
  });

  it("classifies a broker TRANSPORT failure as POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE", async () => {
    // Real client code path: ChittyServClient runs against a fetch that fails
    // the way a network outage does. No module mocks — only the transport.
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("connect ETIMEDOUT"),
    );

    const env = {
      CREDENTIAL_BROKER_TYPE: "chittyserv",
      CHITTYSERV_URL: "https://chittyserv.invalid",
      CHITTYSERV_TOKEN: "not-a-real-token",
    };

    const result = await getCredentialResult(
      env,
      "services/chittyid/service_token",
      "__NONE__",
      "chittyid",
    );

    expect(result.value).toBeUndefined();
    expect(result.errorClass).toBe(CREDENTIAL_ERROR_CLASS.BROKER_UNAVAILABLE);
  });

  it("classifies a broker 404 as MISSING_CREDENTIAL_MATERIAL, not an outage", async () => {
    // The conflation #303 is about: a 404 means the credential does not exist,
    // which is the ONLY class permitted to request operator provisioning.
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("not found", { status: 404, statusText: "Not Found" }),
    );

    const env = {
      CREDENTIAL_BROKER_TYPE: "chittyserv",
      CHITTYSERV_URL: "https://chittyserv.invalid",
      CHITTYSERV_TOKEN: "not-a-real-token",
    };

    const result = await getCredentialResult(
      env,
      "services/chittycommand/org_automation_token",
      "__NONE__",
      "chittycommand",
    );

    expect(result.value).toBeUndefined();
    expect(result.errorClass).toBe(CREDENTIAL_ERROR_CLASS.MISSING_MATERIAL);
  });

  it("keeps the two classes distinct — they are not interchangeable", () => {
    // MISSING_CREDENTIAL_MATERIAL is the only class permitted to request
    // operator provisioning. Collapsing them is the #303 defect.
    expect(CREDENTIAL_ERROR_CLASS.MISSING_MATERIAL).not.toBe(
      CREDENTIAL_ERROR_CLASS.BROKER_UNAVAILABLE,
    );
    expect(CREDENTIAL_ERROR_CLASS.MISSING_MATERIAL).toBe(
      "MISSING_CREDENTIAL_MATERIAL",
    );
    expect(CREDENTIAL_ERROR_CLASS.BROKER_UNAVAILABLE).toBe(
      "POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE",
    );
  });
});

describe("observability of the fall-through", () => {
  it("emits a structured event naming the tier that served the credential", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = {
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
      NOTION_TOKEN: "notion-managed-secret",
    };

    await getCredentialResult(
      env,
      "integrations/notion/api_key",
      "NOTION_TOKEN",
      "notion",
    );

    const events = warn.mock.calls
      .map(([line]) => line)
      .filter((line) => typeof line === "string" && line.startsWith("[credential] "))
      .map((line) => JSON.parse(line.replace("[credential] ", "")));

    const served = events.find((e) => e.outcome === "served");
    expect(served).toBeDefined();
    expect(served.tier).toBe("binding");
    expect(served.binding).toBe("NOTION_TOKEN");
  });

  it("does not report a broker MISS as broker unavailability", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = {
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
      NOTION_TOKEN: "notion-managed-secret",
    };

    await getCredentialResult(
      env,
      "integrations/notion/api_key",
      "NOTION_TOKEN",
      "notion",
    );

    const events = warn.mock.calls
      .map(([line]) => line)
      .filter((line) => typeof line === "string" && line.startsWith("[credential] "))
      .map((line) => JSON.parse(line.replace("[credential] ", "")));

    // A credential simply not mapped in the broker must not raise a false
    // "broker is down" signal — that is the conflation #303 is about.
    expect(events.some((e) => e.outcome === "unavailable")).toBe(false);
  });

  it("never puts the credential value into the event", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = {
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
      NOTION_TOKEN: "super-secret-do-not-log",
    };

    await getCredentialResult(
      env,
      "integrations/notion/api_key",
      "NOTION_TOKEN",
      "notion",
    );

    const logged = warn.mock.calls.map(([line]) => String(line)).join("\n");
    expect(logged).not.toContain("super-secret-do-not-log");
  });
});

describe("multi-candidate resolution survives (PR #277 regression)", () => {
  it("getCredential returns undefined rather than throwing, so || chains continue", async () => {
    const env = { CREDENTIAL_BROKER_TYPE: "cloudflare-secrets" };

    const first = await getCredential(env, "a/missing/path", "__NONE__", "x");
    expect(first).toBeUndefined();

    // The whole point: a broken first candidate must not hide a working second.
    const resolved =
      first ||
      (await getCredential(
        { ...env, NOTION_TOKEN: "second-candidate-works" },
        "integrations/notion/api_key",
        "NOTION_TOKEN",
        "notion",
      ));

    expect(resolved).toBe("second-candidate-works");
  });

  it("getMintAuthToken falls past an empty binding to a later candidate", async () => {
    const env = {
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
      CHITTYAUTH_ISSUED_MINT_API_KEY: storeBinding(""),
      MINT_API_KEY: "third-candidate-key",
    };

    const { token } = await getMintAuthToken(env);
    expect(token).toBe("third-candidate-key");
  });
});

describe("getServiceToken", () => {
  it("returns a string, not a Secrets Store binding object", async () => {
    const env = {
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
      CHITTYAUTH_ISSUED_ID_TOKEN: storeBinding("chittyid-service-token"),
    };

    const token = await getServiceToken(env, "chittyid");
    expect(token).toBe("chittyid-service-token");
    expect(typeof token).toBe("string");
  });

  it("still honours the legacy CHITTY_*_TOKEN spelling", async () => {
    const env = {
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
      CHITTY_LEDGER_TOKEN: "legacy-ledger-token",
    };

    expect(await getServiceToken(env, "chittyledger")).toBe(
      "legacy-ledger-token",
    );
  });
});

describe("a rejecting binding must not kill the chain (PR #277 at the hot tier)", () => {
  /** A Secrets Store binding whose .get() rejects: store unreachable, entry deleted. */
  function rejectingBinding(message = "secrets store unreachable") {
    return {
      get: async () => {
        throw new Error(message);
      },
    };
  }

  it("getCredential returns undefined instead of throwing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = {
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
      NOTION_TOKEN: rejectingBinding(),
    };

    await expect(
      getCredential(env, "integrations/notion/api_key", "NOTION_TOKEN", "notion"),
    ).resolves.toBeUndefined();
  });

  it("getMintAuthToken still reaches a later working candidate", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = {
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
      CHITTYAUTH_ISSUED_MINT_API_KEY: rejectingBinding(),
      MINT_API_KEY: "works-fine",
    };

    const { token } = await getMintAuthToken(env);
    expect(token).toBe("works-fine");
  });

  it("getServiceToken still falls through to the legacy name", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = {
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
      CHITTYAUTH_ISSUED_ID_TOKEN: rejectingBinding(),
      CHITTY_ID_TOKEN: "legacy-still-works",
    };

    expect(await getServiceToken(env, "chittyid")).toBe("legacy-still-works");
  });

  it("records the binding failure rather than swallowing it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = {
      CREDENTIAL_BROKER_TYPE: "cloudflare-secrets",
      NOTION_TOKEN: rejectingBinding("entry deleted"),
    };

    await getCredential(env, "integrations/notion/api_key", "NOTION_TOKEN", "notion");

    const logged = warn.mock.calls.map(([l]) => String(l)).join("\n");
    expect(logged).toContain("binding_error");
  });
});

describe("the escalation signal stays alertable", () => {
  it("a routine multi-candidate miss does not emit MISSING_CREDENTIAL_MATERIAL per candidate", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { CREDENTIAL_BROKER_TYPE: "cloudflare-secrets" };

    await getMintAuthToken(env);

    const events = warn.mock.calls
      .map(([line]) => line)
      .filter((l) => typeof l === "string" && l.startsWith("[credential] "))
      .map((l) => JSON.parse(l.replace("[credential] ", "")));

    const escalations = events.filter(
      (e) => e.errorClass === CREDENTIAL_ERROR_CLASS.MISSING_MATERIAL,
    );

    // Adversarial review measured four per call before candidate mode existed.
    // Each named a candidate that is EXPECTED to be absent, so any alert on the
    // class was all false positives.
    expect(escalations.length).toBeLessThanOrEqual(1);
  });
});
