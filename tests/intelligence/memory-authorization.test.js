import { describe, expect, it } from "vitest";
import { authorizeMemorySession } from "../../src/lib/memory-authorization.js";

function context({ keyInfo = {}, header } = {}) {
  return {
    get(name) {
      if (name === "apiKey") return keyInfo;
      return undefined;
    },
    req: {
      header(name) {
        if (name === "X-ChittyID") return header;
        return undefined;
      },
    },
  };
}

function memory(boundPersonId) {
  return {
    async resolveSessionSyntheticPerson(sessionId) {
      expect(sessionId).toBe("session-1");
      return boundPersonId;
    },
    isCanonicalPersonId(value) {
      return typeof value === "string" && value.split("-")[4] === "P";
    },
  };
}

describe("Experience Projection memory authorization", () => {
  const person = "03-1-USA-0650-P-2606-1-24";
  const other = "03-1-USA-0651-P-2606-1-25";

  it("authorizes the authenticated P that owns the active session", async () => {
    await expect(
      authorizeMemorySession(
        context({ keyInfo: { userId: person }, header: person }),
        memory(person),
        "session-1",
      ),
    ).resolves.toBe(person);
  });

  it("rejects a different authenticated P even with a valid session id", async () => {
    await expect(
      authorizeMemorySession(
        context({ keyInfo: { userId: other } }),
        memory(person),
        "session-1",
      ),
    ).rejects.toMatchObject({ code: "MEMORY_SCOPE_FORBIDDEN", status: 403 });
  });

  it("rejects service keys with no P-bound principal", async () => {
    await expect(
      authorizeMemorySession(
        context({ keyInfo: { service: "some-service" } }),
        memory(person),
        "session-1",
      ),
    ).rejects.toMatchObject({ code: "MEMORY_PRINCIPAL_UNBOUND", status: 403 });
  });

  it("rejects an asserted X-ChittyID that differs from the bound P", async () => {
    await expect(
      authorizeMemorySession(
        context({ keyInfo: { userId: person }, header: other }),
        memory(person),
        "session-1",
      ),
    ).rejects.toMatchObject({ code: "MEMORY_IDENTITY_MISMATCH", status: 403 });
  });

  it("rejects sessions without an active P binding", async () => {
    await expect(
      authorizeMemorySession(
        context({ keyInfo: { userId: person } }),
        memory(null),
        "session-1",
      ),
    ).rejects.toMatchObject({ code: "MEMORY_SCOPE_UNRESOLVED", status: 403 });
  });
});
