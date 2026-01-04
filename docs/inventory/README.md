# Cloudflare Inventory & Registration

This repo includes tooling to discover Cloudflare Workers/compute resources and prepare them for registration in the ChittyOS Ecosystem Authority.

Workflow
- Cloudflare Inventory (GitHub Actions): `.github/workflows/cloudflare-inventory.yml`
  - Requires repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
  - Produces an artifact `cloudflare-inventory.json` with:
    - Workers scripts, KV namespaces, Queues, D1 databases, Vectorize indexes
    - Limited per‑script details and bindings

Local run
```
CLOUDFLARE_API_TOKEN=... node scripts/cloudflare-inventory.js --account <ACCOUNT_ID> --out cloudflare-inventory.json
```

Next steps (registration)
- Import the inventory JSON into the Authority (ChittyRegistry) when available
- Until the Registry is implemented, commit a curated subset to `docs/inventory/registry.json` for onboarding pages

Notes
- `account_id` also read from `wrangler.toml` or env `CLOUDFLARE_ACCOUNT_ID`
- API failures are captured in the JSON under `error`

