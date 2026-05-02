# Credential Ownership Law

Canonical URI: `chittycanon://docs/ops/policy/credential-ownership-law`

## Purpose

Define non-overlapping ownership for credential issuance, certificate issuance, key custody, and mint operations across ChittyOS services.

## Binding Rules

1. `chittyauth` is the system of record for API credential issuance and rotation.
2. `chittycypher` is co-owner for mint secret issuance and key custody workflows.
3. `chittymint` consumes credentials for mint operations and does not own cross-service credential lifecycle.
4. `chittycert` issues and revokes certificates; `chittytrust` evaluates trust and proxies certificate operations.
5. `chittyid` governs identity format and issuance pipeline policy.
6. Runtime secret delivery is Cloudflare Secrets Store; source-of-truth remains 1Password.

## Required Naming in ChittyConnect

1. Preferred service auth binding pattern: `CHITTYAUTH_ISSUED_<SERVICE>_TOKEN`.
2. Canonical mint runtime binding: `CHITTYAUTH_ISSUED_MINT_API_KEY`.
3. Transitional alias accepted for mint: `MINT_API_KEY`.
4. Legacy fallback pattern: `CHITTY_<SERVICE>_TOKEN`.
5. Legacy fallback only for mint webhook compatibility: `CHITTYMINT_SECRET` (deprecated for API auth).

## Enforcement in ChittyConnect

1. Mint auth token resolution order:
   1. `CHITTYAUTH_ISSUED_MINT_API_KEY`
   2. `CHITTYAUTH_ISSUED_MINT_TOKEN`
   3. `MINT_API_KEY`
   4. `services/chittymint/service_token` broker path
   5. `CHITTYMINT_SECRET` (deprecated)
2. All non-mint service token resolution order:
   1. `CHITTYAUTH_ISSUED_<SERVICE>_TOKEN`
   2. `services/<service>/service_token` broker path
   3. `CHITTY_<SERVICE>_TOKEN` (legacy)
3. Any use of `CHITTYMINT_SECRET` for mint API authorization must emit a deprecation warning.

## Operational Controls

1. Rotate auth-issued mint tokens through `chittyauth` policy.
2. Propagate rotated values to Cloudflare Secrets Store per environment.
3. Keep cert issuance and trust attestation out of token issuance workflows.
