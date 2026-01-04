# Secrets Model & Provisioning

Sources of truth
- 1Password vaults for long‑lived credentials (owners: security + service)
- Wrangler secrets per environment (staging/production)
- ChittyAuth for ephemeral CI tokens via ChittyConnect

Standard env names
- CHITTY_AUTH_TOKEN — auth.chitty.cc
- CHITTY_REGISTRY_TOKEN — registry.chitty.cc
- CHITTY_ID_TOKEN — id.chitty.cc (where applicable)
- CHITTY_DNA_TOKEN — dna.chitty.cc (optional)

GitHub Actions
- Ephemeral deploy creds fetched via ChittyConnect: `/credentials/deploy`
- Repository secret CHITTYCONNECT_API_KEY must exist or be provisioned earlier in the workflow

Rotation
- 90‑day rotation for long‑lived credentials
- Immediate rotation on incident, audit all provisions

Audit & revocation
- `/api/credentials/audit` — recent provisions
- `/api/credentials/revoke` — revoke compromised token

