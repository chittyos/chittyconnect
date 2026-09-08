/**
 * The account's workers.dev subdomain is `ccorp` — verified against
 * GET /accounts/{id}/workers/subdomain on 2026-09-05, which returned
 * { "subdomain": "ccorp" }.
 *
 * This repo had drifted to THREE different spellings simultaneously:
 * `ccorp.workers.dev` (docs, correct), `chittyos.workers.dev`
 * (wrangler.jsonc), and `chitty.workers.dev` (scripts/quick-deploy.sh).
 * Two of the three named hosts that do not exist.
 *
 * That was not merely cosmetic. wrangler.jsonc set staging's
 * CHITTYCONNECT_URL to the `chittyos` spelling, and
 * src/services/DocumentStorageService.js:163 builds presigned document
 * download URLs from exactly that var — so every download link minted in
 * staging pointed at a nonexistent host.
 *
 * These assertions read the real files rather than a fixture, so they fail
 * if the subdomain drifts again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKERS_DEV = /https?:\/\/[a-z0-9-]+\.([a-z0-9-]+)\.workers\.dev/gi;

function subdomainsIn(relPath) {
  const text = readFileSync(join(repoRoot, relPath), "utf8");
  return [...text.matchAll(WORKERS_DEV)].map((m) => m[1].toLowerCase());
}

describe("workers.dev subdomain", () => {
  it("wrangler.jsonc names only the real account subdomain", () => {
    const found = subdomainsIn("wrangler.jsonc");
    expect(found.length).toBeGreaterThan(0);
    expect([...new Set(found)]).toEqual(["ccorp"]);
  });

  it("scripts/quick-deploy.sh names only the real account subdomain", () => {
    expect([...new Set(subdomainsIn("scripts/quick-deploy.sh"))]).toEqual([
      "ccorp",
    ]);
  });

  it("no CHITTYCONNECT_URL points at a workers.dev host we do not own", () => {
    const raw = readFileSync(join(repoRoot, "wrangler.jsonc"), "utf8");
    const urls = [...raw.matchAll(/"CHITTYCONNECT_URL":\s*"([^"]+)"/g)].map(
      (m) => m[1],
    );
    // dev (localhost), staging (workers.dev), production (zone).
    expect(urls).toHaveLength(3);
    expect(urls).toContain("https://chittyconnect-staging.ccorp.workers.dev");
    expect(urls).toContain("https://connect.chitty.cc");

    for (const url of urls) {
      const m = url.match(/\.([a-z0-9-]+)\.workers\.dev/i);
      if (m) expect(m[1].toLowerCase()).toBe("ccorp");
    }
  });
});
