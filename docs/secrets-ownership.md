# ChittyConnect Secrets Ownership

Canonical URI: `chittycanon://docs/ops/policy/secrets-ownership`

## Ownership

| Secret Class | Owner | Notes |
|---|---|---|
| `mint_*` and mint API secrets | `chittyauth` + `chittycypher` | Canonical issuer and rotation authority |
| `cert_*`, TLS cert, signing cert material | `chittytrust` + `chittycert` | Certificate exception class |
| Runtime delivery to workers | `chittyconnect` | Consumption only, not issuance |

## Canonical Naming Contract

1. Cloudflare Secrets Store key: `chittyauth_issued_mint_api_key`
2. Runtime env var in services: `CHITTYAUTH_ISSUED_MINT_API_KEY`
3. Transitional aliases permitted for one release:
   1. `CHITTYAUTH_ISSUED_MINT_TOKEN`
   2. `MINT_API_KEY`
   3. `CHITTYMINT_SECRET` (legacy webhook compatibility only)

## Approval & Rotation Controls

1. Any create/rotate/revoke action requires one approver from secret owner team and one platform reviewer.
2. Default token rotation interval: 90 days.
3. Break-glass injections must be logged with issuer, timestamp, expiry, and follow-up rotation ticket.
