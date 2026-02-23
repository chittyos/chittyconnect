# Fact Governance Hardening Design

> Canonical URI: `chittycanon://docs/tech/spec/fact-governance-hardening`
> Status: DRAFT
> Date: 2026-02-23
> Service: ChittyConnect (`chittycanon://core/services/chittyconnect`)

## 1. Overview

Harden the fact governance lifecycle in ChittyConnect with cryptographic integrity anchors, RBAC enforcement, and ChittyProof integration. Facts follow an immutable lifecycle: **draft -> verified -> sealed**. At each stage, integrity data is captured. At seal time, a full ChittyProof bundle is minted via the ChittyProof service.

### Approach: ChittyProof Integration via ChittyConnect Gateway (Approach A)

ChittyConnect acts as a thin orchestration layer. On `fact_mint`, it calls ChittyLedger to create the draft fact, capturing `evidence_hash_at_mint`. On `fact_validate`, it calls ChittyLedger for status transition. On **seal** (the terminal state), ChittyConnect enqueues a proof job that calls ChittyProof to mint a 11-pillar proof bundle, anchor to ChittyChain, and produce an ECDSA-P256 signature. Export generates a JSON proof bundle; PDF via ChittyProof's PDX export stored in R2.

## 2. Architecture

```
AI/User -> ChittyConnect (gateway) -> ChittyLedger (state) -[queue]-> ChittyProof (proof on seal)
                |                           |                              |
           RBAC check               hash integrity                  ChittyProof bundle
           trust level              state machine                   ChittyChain anchor
           evidence preflight       audit log                       ECDSA signature
```

### Three Layers

| Layer | Service | URL | Tier | Responsibility |
|-------|---------|-----|------|---------------|
| Gateway | ChittyConnect | connect.chitty.cc | 2 (Platform) | RBAC, evidence preflight, orchestration, export API |
| State | ChittyLedger | ledger.chitty.cc | 4 (Domain) | Fact lifecycle (draft->verified->sealed), hash chain, audit log |
| Proof | ChittyProof | proof.chitty.cc | 4 (Domain) | 11-pillar proof bundle on seal, ChittyChain anchor, PDF export |

> @canon: chittycanon://gov/governance#core-types
>
> Entity classifications in this design:
> - **Fact** = Thing (T) -- object without agency
> - **Evidence** = Thing (T)
> - **Seal/Dispute/Validation** = Event (E) -- occurrence in time
> - **Acting user** = Person (P) -- actor with agency
> - **Trust/Certification** = Authority (A) -- source of weight
> - **Jurisdiction** = Location (L) -- constrains RBAC when applicable

### Defense in Depth

ChittyConnect validates before forwarding. ChittyLedger enforces state machine rules. ChittyProof seals the final proof. No single layer trusts another blindly.

## 3. Fact Lifecycle with Integrity Anchors

```
                    +----------+
                    |  DRAFT   | <- evidence_hash_at_mint (SHA-256 snapshot)
                    +----+-----+   fact_hash (SHA-256 of text + evidence_id + timestamp)
                         |
              +----------+----------+
              v                     v
        +----------+         +----------+
        | VERIFIED |         | REJECTED |
        +----+-----+         +----------+
             | corroborating_evidence_hashes[]
             | validation_method + notes
             |
    +--------+--------+
    v                 v
+--------+      +----------+
| SEALED |      | DISPUTED | -> back to VERIFIED after resolution
+--------+      +----------+
     |
     v
ChittyProof.mint() -> 11-pillar proof bundle
                       ChittyChain anchor
                       ECDSA-P256 signature
                       Verification URL
                       ChittyID (entity type FACT) minted
```

### Integrity Actions per Transition

| Transition | Integrity Action |
|-----------|-----------------|
| -> draft | `fact_hash` = SHA-256(fact_text + evidence_id + created_at), `evidence_hash_at_mint` captured from source evidence |
| -> verified | `corroborating_hashes` JSONB captured [{evidence_id, hash, validated_at}], validation audit logged |
| -> sealed | Proof job enqueued to `PROOF_Q`. Queue consumer: ChittyProof mints proof, returns `proof_id`, `blockchain_record_id`, `verification_url`. ChittyID with entity type FACT minted for external identifier |
| -> disputed | `dispute_id` FK to `disputes` table, dispute reason + challenger recorded. Proof remains valid until resolution |

## 4. RBAC Model

Access control at ChittyConnect gateway using canonical ChittyID entity types and ChittyTrust levels (0-5 scale).

> @canon: chittycanon://docs/tech/spec/chittyid-spec#trust-levels
>
> Trust levels: ANONYMOUS (0), BASIC (1), ENHANCED (2), PROFESSIONAL (3), INSTITUTIONAL (4), OFFICIAL (5)

| Action | Required Entity Type | Min Trust Level | Canonical Name |
|--------|---------------------|-----------------|----------------|
| `fact_mint` (-> draft) | Person (P) | 1 | BASIC |
| `fact_validate` (-> verified) | Person (P) or Authority (A) | 3 | PROFESSIONAL |
| `fact_seal` (-> sealed, triggers ChittyProof) | Authority (A) | 4 | INSTITUTIONAL |
| `fact_dispute` | Person (P) | 2 | ENHANCED |
| `fact_export` (read proof bundle) | Any authenticated | 1 | BASIC |

Trust levels resolved at runtime via ChittyTrust (`trust.chitty.cc`), cached in `CREDENTIAL_CACHE` KV with 5-minute TTL.

## 5. New MCP Tools

Three new tools added to ChittyConnect (bringing total to 36):

### `chitty_fact_seal`

Lock a verified fact permanently, triggering async ChittyProof minting.

- **Input**: `fact_id` (string), `seal_reason` (string, optional), `actor_chitty_id` (string)
- **Gateway**: RBAC check (Authority entity type, trust >= INSTITUTIONAL)
- **Verify**: Fact status must be "verified" in ChittyLedger
- **Sync action**: POST to `ledger.chitty.cc/api/facts/{id}/seal` (state -> sealed, proof_status -> PENDING)
- **Async action**: Enqueue to `PROOF_Q` for ChittyProof minting
- **Returns**: `{ fact_id, status: "sealed", proof_status: "PENDING", chitty_id }` (proof completes async)

### `chitty_fact_dispute`

Dispute a verified or sealed fact.

- **Input**: `fact_id` (string), `reason` (string), `challenger_chitty_id` (string, optional), `counter_evidence_ids` (array of strings, optional)
- **Gateway**: RBAC check (Person, trust >= ENHANCED), verify counter evidence exists in ChittyLedger
- **Action**: POST to `ledger.chitty.cc/api/facts/{id}/dispute`, creates row in `disputes` table, links via `dispute_id` FK
- **Returns**: `{ fact_id, status: "disputed", dispute_id }`

### `chitty_fact_export`

Export fact with full proof bundle.

- **Input**: `fact_id` (string), `format` ("json" | "pdf")
- **Gateway**: RBAC check (any authenticated, trust >= BASIC)
- **JSON**: Returns proof bundle inline (fact text, evidence chain, all hashes, ChittyProof pillars, verification URL)
- **PDF**: Triggers ChittyProof PDX export, stored in R2 (`chittyos-files` bucket under `exports/facts/`), returns streaming download URL
- **Returns**: JSON proof bundle, or `{ download_url, size, expires_at }` for PDF

## 6. Database Schema Changes

Target: `atomic_facts` table in ChittyLedger Neon database.

> Table has 49 existing columns, currently 0 rows — zero migration risk.

### New Columns

```sql
-- Integrity anchors
fact_hash                TEXT        -- SHA-256(fact_text || evidence_id || created_at). Immutable once set.
evidence_hash_at_mint    TEXT        -- SHA-256 of source evidence file at mint time
corroborating_hashes     JSONB       -- [{evidence_id, hash, validated_at}] set at validation (write-once)

-- ChittyProof (set on seal)
proof_id                 TEXT        -- ChittyProof proof identifier
blockchain_record_id     UUID REFERENCES blockchain_records(id)  -- FK to existing table
verification_url         TEXT        -- Public proof verification URL
proof_score              NUMERIC(4,2) CHECK (proof_score >= 0 AND proof_score <= 11)  -- Pillar score
proof_status             fact_proof_status DEFAULT 'NONE'  -- Enum: NONE | PENDING | MINTED | FAILED

-- RBAC audit
locked_by                TEXT        -- ChittyID of authority who sealed
lock_reason              TEXT
locked_at                TIMESTAMPTZ -- Timestamp of seal
dispute_id               UUID REFERENCES disputes(id)  -- FK to existing disputes table
```

### New Enum

```sql
CREATE TYPE fact_proof_status AS ENUM ('NONE', 'PENDING', 'MINTED', 'FAILED');
```

### Indexes

```sql
CREATE UNIQUE INDEX idx_facts_fact_hash ON atomic_facts (fact_hash) WHERE fact_hash IS NOT NULL;
CREATE INDEX idx_facts_proof_status ON atomic_facts (proof_status) WHERE proof_status IN ('PENDING', 'FAILED');
CREATE INDEX idx_facts_locked_by ON atomic_facts (locked_by) WHERE locked_by IS NOT NULL;
CREATE INDEX idx_facts_dispute_id ON atomic_facts (dispute_id) WHERE dispute_id IS NOT NULL;
CREATE INDEX idx_facts_blockchain_record ON atomic_facts (blockchain_record_id) WHERE blockchain_record_id IS NOT NULL;
CREATE INDEX idx_facts_corroborating ON atomic_facts USING GIN (corroborating_hashes);
```

### Immutability Trigger

```sql
CREATE OR REPLACE FUNCTION prevent_fact_hash_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.fact_hash IS NOT NULL AND NEW.fact_hash IS DISTINCT FROM OLD.fact_hash THEN
    RAISE EXCEPTION 'fact_hash is immutable once set (tamper protection)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fact_hash_immutable
  BEFORE UPDATE ON atomic_facts
  FOR EACH ROW
  EXECUTE FUNCTION prevent_fact_hash_mutation();
```

## 7. ChittyProof Integration

ChittyConnect calls ChittyProof at two points (both async via queue):

### On Seal (Queue Consumer)

```
PROOF_Q message received:
  1. POST proof.chitty.cc/api/v1/proofs/mint
     Body: { type: "fact", content: { fact_id, fact_text, evidence_chain }, signer: authority_chitty_id, chain: true }
     Returns: { proof_id, pillars, score, chain_anchor_id, verification_url }
  2. PATCH ledger.chitty.cc/api/facts/{id}/proof
     Body: { proof_id, blockchain_record_id, verification_url, proof_score, proof_status: "MINTED" }
  3. Mint ChittyID for the fact (entity type FACT) via id.chitty.cc
```

### On PDF Export

```
chitty_fact_export(format: "pdf"):
  1. POST proof.chitty.cc/api/v1/proofs/{proof_id}/export
     Body: { format: "pdx" }
     Returns: PDF bytes
  2. PUT to R2 bucket (chittyos-files) under exports/facts/{case_id}/{timestamp}.pdf
  3. Return streaming download URL
```

### Fallback

If ChittyProof is unavailable, seal still proceeds (ChittyLedger records the state). Proof stays in `PENDING` status. The queue retries with backoff (max 5 retries). Failed proofs land in dead letter queue (`documint-proofs-dlq`) for manual review.

## 8. Cloudflare Infrastructure

### New Bindings (wrangler.toml)

```toml
# Queue for async proof minting
[[queues.producers]]
binding = "PROOF_Q"
queue = "documint-proofs"

[[queues.consumers]]
queue = "documint-proofs"
max_batch_size = 10
max_retries = 5
dead_letter_queue = "documint-proofs-dlq"
```

### New Secrets

```
CHITTY_PROOF_TOKEN       # Service token for proof.chitty.cc
CHITTY_TRUST_TOKEN       # Service token for trust.chitty.cc
```

### New Environment Variables

```toml
CHITTYPROOF_SERVICE_URL = "https://proof.chitty.cc"
CHITTYTRUST_SERVICE_URL = "https://trust.chitty.cc"
```

### Caching

- Trust levels: `CREDENTIAL_CACHE` KV, 5-minute TTL
- Proof verification: Cloudflare Cache API, 1-hour TTL
- Fact reads: Cache API, 60-second TTL with stale-while-revalidate

### PDF Export Flow

PDFs stored in existing R2 bucket (`chittyos-files`) under `exports/facts/` prefix. Streamed via Worker route `GET /api/v1/exports/:key+` — no buffering, direct ReadableStream from R2.

## 9. Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/mcp/tool-dispatcher.js` | Modify | Add `chitty_fact_seal`, `chitty_fact_dispute`, `chitty_fact_export` dispatch with RBAC checks |
| `src/mcp/chatgpt-server.js` | Modify | Add Zod schemas for 3 new tools (total: 36) |
| `src/api/routes/mcp.js` | Modify | Add JSON Schema definitions for 3 new tools |
| `src/lib/chittyproof-client.js` | Create | Thin client for ChittyProof API (mint, export, verify) |
| `src/lib/fact-rbac.js` | Create | RBAC check using ChittyID entity type + ChittyTrust level |
| `src/lib/trust-resolver.js` | Create | Trust level resolution with KV caching |
| `src/handlers/proof-queue.js` | Create | Queue consumer for async proof minting |
| `src/api/routes/exports.js` | Create | R2 streaming download route for PDF exports |
| `tests/mcp/tool-dispatcher.test.js` | Modify | Tests for new tools + RBAC + proof integration |
| `tests/lib/chittyproof-client.test.js` | Create | ChittyProof client unit tests |
| `tests/lib/fact-rbac.test.js` | Create | RBAC logic tests |
| `tests/handlers/proof-queue.test.js` | Create | Queue consumer tests |

## 10. Observability

- **MemoryCloude**: Persist governance events (seal, dispute, export) for session continuity and queryable audit
- **ChittyChronicle**: Log all governance events for compliance audit trail
- **ChittyTrack**: Tail consumer metrics for governance activity dashboards

## 11. Dependencies

### New Dependencies for CHARTER.md

| Relationship | Service | Purpose |
|-------------|---------|---------|
| Upstream | ChittyTrust | Trust level resolution for RBAC |
| Peer | ChittyProof | Document proof minting (11-pillar ChittyProof) |
| Indirect | ChittyChain | Blockchain proof anchoring (via ChittyProof) |

### Prerequisites

1. ChittyProof service registered at `registry.chitty.cc`
2. ChittyLedger API extended with `/seal`, `/dispute`, `/proof` endpoints
3. Service tokens provisioned in 1Password and Wrangler

## 12. Verification

1. Unit tests for RBAC logic, proof client, queue consumer
2. Integration test: `chitty_fact_seal` -> queue message -> proof consumer -> ledger update
3. Local dev: `npm run dev` -> curl test fact lifecycle through MCP
4. Staging: Deploy, test full chain with ChittyLedger staging
5. ChatGPT: Verify 36 tools discovered (3 new governance tools)
