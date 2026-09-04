/**
 * Validation Middleware Tests
 *
 * Exercises the real Hono middleware against real Zod schemas. These cover the
 * failure path specifically: prior to the Zod 4 upgrade nothing in the suite
 * ever sent a request that failed validation, so `fromZodError` reading the
 * removed `ZodError.errors` property went undetected by a fully green CI.
 */

import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { z } from "zod";

import { validateRequest, validateQuery } from "../middleware/validation.js";
import { fromZodError, ValidationError } from "../../lib/errors.js";

// Mirrors the nested record shape used by /api/composite/case-with-parties
const CaseSchema = z.object({
  title: z.string().min(1).max(500),
  caseType: z.enum(["eviction", "litigation", "resolution", "general"]),
  initialEvidence: z
    .record(
      z.object({
        type: z.enum(["document", "photo"]),
      }),
    )
    .optional(),
});

function buildApp() {
  const app = new Hono();
  app.post("/case", validateRequest(CaseSchema), (c) =>
    c.json({ success: true, data: c.get("validated") }),
  );
  app.get(
    "/search",
    validateQuery(z.object({ limit: z.string().regex(/^\d+$/) })),
    (c) => c.json({ success: true }),
  );
  return app;
}

const DEV_ENV = { NODE_ENV: "development" };

describe("validateRequest", () => {
  it("passes a valid body through to the handler", async () => {
    const res = await buildApp().request("/case", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Arias v. Bianchi",
        caseType: "litigation",
        initialEvidence: { alta: { type: "document" } },
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.title).toBe("Arias v. Bianchi");
  });

  it("returns 400 VALIDATION_ERROR instead of throwing on an invalid body", async () => {
    const res = await buildApp().request("/case", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "", caseType: "not-a-case-type" }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("reports per-field errors keyed by dotted path", async () => {
    const app = buildApp();
    const res = await app.fetch(
      new Request("http://localhost/case", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Valid title",
          caseType: "litigation",
          initialEvidence: { alta: { type: "spreadsheet" } },
        }),
      }),
      DEV_ENV,
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.details.fields).toHaveProperty(
      "initialEvidence.alta.type",
    );
  });
});

describe("validateQuery", () => {
  it("returns 400 on an invalid query parameter", async () => {
    const res = await buildApp().request("/search?limit=abc");

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("fromZodError", () => {
  it("maps Zod 4 issues onto fieldErrors", () => {
    const result = CaseSchema.safeParse({ title: "", caseType: "bogus" });
    expect(result.success).toBe(false);

    const err = fromZodError(result.error);
    expect(err).toBeInstanceOf(ValidationError);
    expect(err.statusCode).toBe(400);
    expect(Object.keys(err.fieldErrors).sort()).toEqual(["caseType", "title"]);
  });

  it("handles a root-level failure whose issue path is empty", () => {
    const result = CaseSchema.safeParse("not an object");
    expect(result.success).toBe(false);

    const err = fromZodError(result.error);
    expect(err.fieldErrors).toHaveProperty("");
  });
});
