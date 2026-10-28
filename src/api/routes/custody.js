/**
 * Runtime custody diagnostic for the #228 closure gate.
 *
 * This endpoint verifies only capabilities that actually exist in the runtime.
 * Missing signing/ledger authority surfaces are reported as unverified rather
 * than replaced with mock success.
 */

import { Hono } from "hono";
import { authenticate } from "../middleware/auth.js";
import { githubOIDCMiddleware } from "../../auth/github-oidc.js";
import { generateAppJWT } from "../../auth/github.js";

const custodyRoutes = new Hono();

custodyRoutes.use(
  "*",
  githubOIDCMiddleware({ audience: "https://connect.chitty.cc" }),
);
custodyRoutes.use("*", async (c, next) => {
  if (c.get("auth")?.type === "github_oidc") {
    await next();
    return;
  }
  return authenticate(c, next);
});

custodyRoutes.get("/custody-verify", async (c) => {
  const githubAppIdPresent = Boolean(c.env.GITHUB_APP_ID);
  let githubAppPkValid = false;

  if (githubAppIdPresent && c.env.GITHUB_APP_PK) {
    try {
      const jwt = await generateAppJWT(c.env.GITHUB_APP_ID, c.env.GITHUB_APP_PK);
      githubAppPkValid =
        typeof jwt === "string" && jwt.split(".").length === 3;
    } catch {
      githubAppPkValid = false;
    }
  }

  // No broker signing-as-a-service entrypoint exists yet in the current
  // ChittyConnect/chittysecrets runtime. Keep this gate truthfully unverified.
  const brokerSigningKeyCustody = "unverified";

  // SVC_LEDGER is bound, but there is currently no authority-check operation
  // proving ChittyConnect can emit the required git-domain receipt.
  const ledgerEmissionAuthority = "unverified";

  const allVerified =
    githubAppIdPresent &&
    githubAppPkValid &&
    brokerSigningKeyCustody === "verified" &&
    ledgerEmissionAuthority === "verified";

  return c.json(
    {
      issue_ref: "chittyos/chittyconnect#228",
      github_app_id_present: githubAppIdPresent,
      github_app_pk_valid: githubAppPkValid,
      broker_signing_key_custody: brokerSigningKeyCustody,
      ledger_emission_authority: ledgerEmissionAuthority,
      signer_binding_present: Boolean(c.env.SVC_SECRETS),
      ledger_binding_present: Boolean(c.env.SVC_LEDGER),
      ready_for_gate_4_tx: allVerified,
      checked_at: new Date().toISOString(),
    },
    allVerified ? 200 : 503,
  );
});

export { custodyRoutes };
