/**
 * Identity-bound policy bundle.
 *
 * Serves the system-wide governance bundle keyed by ChittyID so any channel
 * (Claude Code, Desktop, Mobile, web, ChatGPT, …) can fetch the same policy
 * on session start. Closes the cross-channel enforcement gap where local
 * hooks only fire on the VM.
 *
 * @canon: chittycanon://gov/governance#core-types
 */

import { Hono } from "hono";
import bundle from "../../../policy-bundle/v1/bundle.json";

const identityRoutes = new Hono();

// ChittyID format: VV-G-LLL-SSSS-T-YYMM-C-XX where T ∈ {P,L,T,E,A}.
// Char classes follow the canonical validator in CHITTYFOUNDATION/chittyid
// (src/agents/validator.js): VV=2 digits, G=[A-Z0-9], LLL=3 letters,
// SSSS=4 digits, T=P/L/T/E/A, YM=3-4 digits (canon spec says 3; live mint
// emits 4, e.g. `03-1-USA-5537-P-2602-0-38`), C=trust 0-5, XX=mod-97 checksum.
// @canon: chittycanon://gov/governance#core-types
const CHITTYID_RE =
  /^\d{2}-[A-Z0-9]-[A-Z]{3}-\d{4}-[PLTEA]-\d{3,4}-[0-5]-\d{1,2}$/;

const etag = `W/"${bundle.sha256}"`;

function validateChittyId(c) {
  const id = c.req.param("chittyId");
  if (!CHITTYID_RE.test(id)) {
    return c.json(
      { error: "INVALID_CHITTYID", message: "ChittyID must match VV-G-LLL-SSSS-T-YM-C-X with T ∈ P/L/T/E/A" },
      400,
    );
  }
  return null;
}

identityRoutes.get("/:chittyId/policy-bundle", (c) => {
  const err = validateChittyId(c);
  if (err) return err;

  if (c.req.header("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  c.header("ETag", etag);
  c.header("Cache-Control", "public, max-age=300, must-revalidate");
  // `generated_at` is intentionally omitted from the served representation:
  // the ETag is derived from `sha256` (content hash only), so including a
  // rebuild timestamp that changes without a content change would violate
  // HTTP caching semantics (same ETag, different body).
  return c.json({
    chittyId: c.req.param("chittyId"),
    version: bundle.version,
    scope: bundle.scope,
    sha256: bundle.sha256,
    bundle: bundle.files,
  });
});

identityRoutes.get("/:chittyId/policy-bundle/check", (c) => {
  const err = validateChittyId(c);
  if (err) return err;

  if (c.req.header("If-None-Match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }
  c.header("ETag", etag);
  return c.json({
    chittyId: c.req.param("chittyId"),
    version: bundle.version,
    sha256: bundle.sha256,
  });
});

export { identityRoutes };
