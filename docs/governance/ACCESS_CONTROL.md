# Access Control & Review Gates

Principles
- Least privilege by default; time‑bound elevation
- Separation of duties for sensitive paths (auth, secrets, scopes)
- Traceability via audit logs and PR metadata

Roles
- service-owner: owns runtime and onboarding page
- security: approves auth/secrets/scope changes
- data: approves data layer contracts
- platform: approves CI/CD and infra changes

Review cadence
- Quarterly access review for long‑lived tokens
- Post‑incident break‑glass review within 48h

Gates (enforced in CI)
- Changes touching: .github/workflows/**, wrangler.toml, src/auth/**, etc/chittyos/scopes.yml
  - Require PR labels: security-approved, docs-approved, access-reviewed
  - Require owners in CODEOWNERS

Audit
- Credential provisioning logged by ChittyConnect `/api/credentials/audit`
- CI runs reference PR number and labels; retained 1 year

