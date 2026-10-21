/**
 * The secret-scan workflow's trust model, asserted so a regression fails CI
 * rather than silently reopening the hole.
 *
 * WHY THIS FILE EXISTS
 *
 * The first revision of `.github/workflows/secret-scan.yml` triggered on
 * `pull_request`. Under that event GitHub reads BOTH the workflow file and the
 * checked-out tree from the pull request's merge revision — so a contributor
 * could edit the workflow, or allowlist their own payload in `.gitleaks.toml`,
 * and the scan would report clean on exactly the change that needed scanning.
 * The scanner enforced a config supplied by the party being scanned.
 *
 * That revision passed every check it had. `continue-on-error` was absent,
 * `--exit-code 1` was present, `permissions` was `contents: read`,
 * `fetch-depth` was 0, `--redact` was set, and `.gitleaks.toml` correctly
 * carried `[extend] useDefault = true`. Every one of those was true and the
 * gate was still subvertible, because none of them is the property that
 * matters here. A review that checks whether a gate CAN fail is not the same as
 * checking whether it can fail against the adversary it exists to stop.
 *
 * These assertions are deliberately about the trust boundary and nothing else.
 * They do not duplicate "does gitleaks work" — that is gitleaks' own problem.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import YAML from "yaml";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const workflowPath = join(repoRoot, ".github", "workflows", "secret-scan.yml");

const raw = readFileSync(workflowPath, "utf8");
const doc = YAML.parse(raw);
// `on:` is YAML 1.1's boolean `true`; the `yaml` package parses per YAML 1.2
// where it stays the string "on". Accept either so this test does not become a
// parser-version trap.
const triggers = doc.on ?? doc[true];
const steps = doc.jobs.gitleaks.steps;
const allRunScript = steps.map((s) => s.run ?? "").join("\n");

describe("secret-scan workflow trust model", () => {
  it("does NOT trigger on bare pull_request", () => {
    // This is the whole finding. `pull_request` hands the attacker both the
    // scanner and its ruleset.
    expect(Object.keys(triggers)).not.toContain("pull_request");
  });

  it("triggers on pull_request_target, so workflow and config come from base", () => {
    expect(Object.keys(triggers)).toContain("pull_request_target");
  });

  it("checks out the BASE revision, never the PR's merge revision", () => {
    const checkout = steps.find((s) => (s.uses ?? "").startsWith("actions/checkout"));
    expect(checkout).toBeDefined();
    // Must name base.sha. A checkout with no `ref` under
    // pull_request_target happens to resolve to base today, but relying on
    // that makes the security property implicit; pin it.
    expect(String(checkout.with.ref)).toContain("pull_request.base.sha");
  });

  it("never checks out, builds, or executes pull request code", () => {
    // The PR is fetched as objects into a remote-tracking ref and handed to
    // gitleaks as a commit range. Any `checkout` of head.sha, or a `git
    // checkout`/`switch` onto the PR ref, would put untrusted code in the
    // working tree of a pull_request_target job — the classic escalation.
    expect(allRunScript).not.toMatch(/git\s+(checkout|switch)\s+.*refs\/remotes\/pr/);
    const checkoutSteps = steps.filter((s) => (s.uses ?? "").startsWith("actions/checkout"));
    for (const s of checkoutSteps) {
      expect(String(s.with?.ref ?? "")).not.toContain("head.sha");
    }
  });

  it("keeps least privilege despite pull_request_target being write-capable", () => {
    expect(doc.permissions).toEqual({ contents: "read" });
  });

  it("does not persist git credentials into the job's checkout", () => {
    const checkout = steps.find((s) => (s.uses ?? "").startsWith("actions/checkout"));
    expect(checkout.with["persist-credentials"]).toBe(false);
  });

  it("verifies the gitleaks download against a pinned sha256 before executing it", () => {
    // Version-pinning alone does not stop a swapped release asset: the URL is
    // the same and curl is happy. Only the hash check does.
    expect(allRunScript).toContain("sha256sum -c -");
    const install = steps.find((s) => (s.name ?? "").includes("Install gitleaks"));
    expect(install.env.GITLEAKS_SHA256).toMatch(/^[0-9a-f]{64}$/);
    // Confirmed 2026-10-21 against the release's own checksums.txt AND by
    // downloading gitleaks_8.21.2_linux_x64.tar.gz and hashing it.
    expect(install.env.GITLEAKS_SHA256).toBe(
      "5bc41815076e6ed6ef8fbecc9d9b75bcae31f39029ceb55da08086315316e3ba",
    );
    expect(String(install.env.GITLEAKS_VERSION)).toBe("8.21.2");
  });

  it("still fails the job on a finding", () => {
    // The property the previous revision did have. Kept so a later
    // simplification cannot quietly drop it.
    expect(allRunScript).toContain("--exit-code 1");
    expect(raw).not.toMatch(/continue-on-error:\s*true/);
    expect(allRunScript).toContain("--redact");
  });
});
