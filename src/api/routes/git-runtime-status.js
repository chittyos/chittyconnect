import { Hono } from "hono";
import { generateAppJWT } from "../../auth/github.js";

const gitRuntimeStatusRoutes = new Hono();

/**
 * Non-secret readiness probe for the #228 git broker path.
 * This endpoint never returns secret values, secret references, tokens, or key
 * material. It only reports whether required runtime authorities are usable.
 */
gitRuntimeStatusRoutes.get("/status", async (c) => {
  let githubAppAuth = "unverified";
  let githubAppReason = null;

  try {
    if (!c.env.GITHUB_APP_ID || !c.env.GITHUB_APP_PK) {
      githubAppReason = "github_app_binding_missing";
    } else {
      await generateAppJWT(c.env.GITHUB_APP_ID, c.env.GITHUB_APP_PK);
      githubAppAuth = "verified";
    }
  } catch (error) {
    githubAppReason =
      error instanceof Error ? error.message : "github_app_auth_failed";
  }

  const secretsBrokerBound =
    !!c.env.SVC_SECRETS &&
    typeof c.env.SVC_SECRETS.resolveReference === "function";
  const ledgerBindingBound =
    !!c.env.SVC_LEDGER && typeof c.env.SVC_LEDGER.fetch === "function";

  // #209 signing endpoints are still SPEC-only. Do not report signing custody
  // as verified until the broker can actually resolve and use the signing key
  // without surfacing its reference/value.
  const signingKeyCustody = "unverified";

  const ready =
    githubAppAuth === "verified" &&
    secretsBrokerBound &&
    ledgerBindingBound &&
    signingKeyCustody === "verified";

  return c.json(
    {
      ready,
      github_app_auth: githubAppAuth,
      github_app_reason: githubAppReason,
      secrets_broker_bound: secretsBrokerBound,
      ledger_binding_bound: ledgerBindingBound,
      signing_key_custody: signingKeyCustody,
      capability_surface: "spec_only",
      timestamp: new Date().toISOString(),
    },
    ready ? 200 : 503,
  );
});

export { gitRuntimeStatusRoutes };
