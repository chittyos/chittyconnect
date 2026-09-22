/**
 * GitHub broker routes — credential-owning write authority.
 *
 * Mounted under /api/github. Parent API middleware authenticates the API key;
 * this router additionally binds the authenticated principal to the declared
 * ChittyOS caller and only permits explicitly allowlisted service callers.
 */

import { Hono } from "hono";
import { createIssueWithGitHubApp } from "../../github/issue-authority.js";

const githubBrokerRoutes = new Hono();

function allowedCallers(env) {
  const configured = String(env.GITHUB_BROKER_ALLOWED_CALLERS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return new Set(configured.length > 0 ? configured : ["chittyagent-dispatch"]);
}

githubBrokerRoutes.use("*", async (c, next) => {
  const caller = c.req.header("X-ChittyOS-Caller") || "";
  const principalInfo = c.get("apiKey") || {};
  const principal = principalInfo.service || principalInfo.name || "";

  if (!caller || !allowedCallers(c.env).has(caller)) {
    return c.json(
      { success: false, error: { code: "CALLER_NOT_ALLOWED", message: "caller is not authorized for GitHub broker writes" } },
      403,
    );
  }

  // The header alone is not authority. It must agree with the authenticated
  // API-key principal populated by the parent authenticate middleware.
  if (!principal || principal !== caller) {
    return c.json(
      { success: false, error: { code: "CALLER_PRINCIPAL_MISMATCH", message: "authenticated principal does not match caller" } },
      403,
    );
  }

  c.set("githubBrokerCaller", caller);
  await next();
});

githubBrokerRoutes.post("/issues", async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json(
        { success: false, error: { code: "INVALID_REQUEST", message: "JSON body required" } },
        400,
      );
    }

    const result = await createIssueWithGitHubApp(
      c.env,
      body,
      c.get("githubBrokerCaller"),
    );

    if (!result.ok) {
      return c.json(
        {
          success: false,
          retryable: result.retryable ?? false,
          error: { code: result.code, message: result.error },
        },
        result.status,
      );
    }

    return c.json(
      {
        success: true,
        deduplicated: result.deduplicated,
        repo: result.repo,
        issue_number: result.issue_number,
        issue_url: result.issue_url,
        idempotency_receipt: result.idempotency_receipt,
      },
      result.status,
    );
  } catch (error) {
    console.error("[GitHubBroker] create issue failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return c.json(
      {
        success: false,
        retryable: true,
        error: { code: "BROKER_INTERNAL_ERROR", message: "GitHub broker operation failed" },
      },
      503,
    );
  }
});

export { githubBrokerRoutes };
