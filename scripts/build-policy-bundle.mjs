#!/usr/bin/env node
// Build policy-bundle/v1/bundle.json from vendored canon files.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "policy-bundle", "v1");

const files = {
  contract: "system-wide-sensitive-intent-contract-v1.md",
  policy: "system-wide-sensitive-intent-policy-v1.json",
  conformance: "system-wide-conformance-tests-v1.md",
  integration_map: "system-wide-integration-map-v1.yaml",
  drift_framework: "system-wide-drift-remediation-framework-v1.md",
};

const bundle = {
  version: "v1",
  scope: "system-wide",
  generated_at: new Date().toISOString(),
  files: {},
};

for (const [key, name] of Object.entries(files)) {
  const content = readFileSync(join(root, name), "utf8");
  bundle.files[key] = { name, content };
}

const canonical = JSON.stringify(bundle.files); // hash file contents only (stable)
bundle.sha256 = createHash("sha256").update(canonical).digest("hex");

writeFileSync(join(root, "bundle.json"), JSON.stringify(bundle, null, 2) + "\n");
console.log("Wrote policy-bundle/v1/bundle.json sha256=" + bundle.sha256);
