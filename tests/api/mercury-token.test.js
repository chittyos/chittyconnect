/**
 * Mercury credential-reference resolution tests.
 *
 * Mercury values never live in route context or Worker secret bindings. Routes
 * carry stable chittysecrets:// references and ChittyConnect resolves them only
 * at provider execution time through SVC_SECRETS.
 */
import { describe, it, expect } from "vitest";
import {
  MERCURY_READ_REFERENCES,
  resolveMercuryReadReference,
} from "../../src/api/routes/thirdparty.js";

const CODES = ["ARIBIA", "CITY", "APT", "FC", "CHIT", "ICB", "JAVL", "MNW", "NAJB"];

describe("Mercury read credential references", () => {
  it("defines exactly the nine canonical credential boundaries", () => {
    expect(Object.keys(MERCURY_READ_REFERENCES).sort()).toEqual([...CODES].sort());
    for (const code of CODES) {
      const ref = MERCURY_READ_REFERENCES[code];
      expect(ref.credentialRef).toMatch(/^chittysecrets:\/\/mercury\/[a-z]+\/read$/);
      expect(ref.secretName).toMatch(/^MERCURY_TOKEN_/);
    }
  });

  it("resolves legal/provider aliases without collapsing FC and CHIT", () => {
    expect(resolveMercuryReadReference("aribia-llc")).toBe(MERCURY_READ_REFERENCES.ARIBIA);
    expect(resolveMercuryReadReference("aribia-llc-city-studio")).toBe(MERCURY_READ_REFERENCES.CITY);
    expect(resolveMercuryReadReference("aribia-llc-apt-arlene")).toBe(MERCURY_READ_REFERENCES.APT);
    expect(resolveMercuryReadReference("chicago-furnished-condos")).toBe(MERCURY_READ_REFERENCES.FC);
    expect(resolveMercuryReadReference("chitty-services")).toBe(MERCURY_READ_REFERENCES.CHIT);
    expect(resolveMercuryReadReference("it-can-be-llc")).toBe(MERCURY_READ_REFERENCES.ICB);
    expect(resolveMercuryReadReference("jean-arlene-venturing")).toBe(MERCURY_READ_REFERENCES.JAVL);
    expect(MERCURY_READ_REFERENCES.FC.credentialRef).not.toBe(MERCURY_READ_REFERENCES.CHIT.credentialRef);
  });

  it("supports canonical short codes case-insensitively", () => {
    expect(resolveMercuryReadReference(" FC ")).toBe(MERCURY_READ_REFERENCES.FC);
    expect(resolveMercuryReadReference("najb")).toBe(MERCURY_READ_REFERENCES.NAJB);
  });

  it("fails closed when no explicit credential boundary is supplied", () => {
    for (const bad of [undefined, null, "", "default", "APTA", "__proto__", "constructor"]) {
      expect(() => resolveMercuryReadReference(bad)).toThrow(/Unknown Mercury credential boundary/);
    }
  });
});
