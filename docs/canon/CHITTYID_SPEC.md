# ChittyID — Canonical ID Format and API

Purpose
- Define the canonical ChittyID format and minimum API that all services can depend on.
- ChittyOS uses this spec at id.chitty.cc; other orgs can adopt the same shape.

Format
- Pattern: `VV-G-LLL-SSSS-T-YM-C-X`
  - `VV`: Version (e.g., `01`)
  - `G`: Geographic/Domain code (`C`=standard, `E`=fallback)
  - `LLL`: Lifecycle (`ACT`, `EMG`, `MTR`, `EXP`, `ARC`)
  - `SSSS`: Sequence component (VRF/drand-derived)
  - `T`: Entity type code (`PEO`, `PLACE`, `PROP`, `EVNT`, `AUTH`, `INFO`, `FACT`, `CONTEXT`, `ACTOR`)
  - `YM`: Year-Month in base36 (e.g., `Q5`)
  - `C`: Checksum (Luhn-based) — implementation-defined
  - `X`: Extension/revision (single digit/char)

Example
- `01-C-ACT-4829-PEO-Q5-7-0`

Minimal validation (client-side)
- Segment count and allowed code lists (as above)
- `VV` is digits; `G` ∈ {C,E}; `LLL` in lifecycle set; `T` in type set
- `YM` matches `[0-9A-Z]+` (base36)
- `C` present; checksum verified server-side

DID mapping
- `did:chitty:<ID>` (e.g., `did:chitty:01-C-ACT-4829-PEO-Q5-7-0`)

Response shape (reference)
```
{
  "chittyId": "01-C-ACT-4829-PEO-Q5-7-0",
  "did": "did:chitty:01-C-ACT-4829-PEO-Q5-7-0",
  "entityType": "PERSON",
  "trustLevel": "L1",
  "lifecycle": "ACTIVE",
  "timestamp": "2025-12-10T00:00:00.000Z",
  "verificationMethod": "drand-vrf-beacon"
}
```

API endpoints
- Direct service (current): `id.chitty.cc/v1/*`
  - `POST /v1/mint`
  - `POST /v1/validate`
  - `GET /v1/:id/info`
  - `GET /v1/:id/did`
- Aggregated gateway (recommended): `api.chitty.cc/id/*` → proxies to `id.chitty.cc/v1/*`
- Migration alias (optional): `id.chitty.cc/api/*` → alias to `/v1/*` to meet URL standard

Notes
- Foundation services are near-immutable; ChittyID has no external runtime dependencies.
- Schema docs: prefer schema.chitty.cc; if unavailable, ship local OpenAPI and validate in CI.

