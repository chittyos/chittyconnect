# Managed Context — Ecosystem Credential, Identity, and Entity-Context Standard (RFC)

**Status:** PROPOSED v0.3 — RFC for the ecosystem-wide credential, identity, and entity-context architecture, doctrine-validated against `chittycanon://gov/governance`.
**Term-lifecycle stage** (per `chittycanon://docs/tech/spec/ontology-lifecycle`): **PROPOSED**.
**Canonical URI (target on promotion):** `chittycanon://docs/gov/spec/managed-context`
**Promote-to-canon:** This RFC is drafted in `chittyconnect` for momentum; once accepted by the named reviewers, lift to `chittycanon` and follow the term-lifecycle gates (PROPOSED → SIMULATED → PROVISIONAL → PROVEN → CANONICAL). The chittyconnect-local doc remains as the implementation guide for this service after promotion.
**Author:** ChittyConnect governance
**Created:** 2026-05-04

**Doctrine sources (binding):**
- `chittycanon://gov/governance` (`CHITTYFOUNDATION/chittycanon/GOVERNANCE.md`) — Three Aspects (TY/VY/RY), service-to-aspect mapping, core types, characterizations, naming grammar, Two-Store Rule, Sessions Are Viewports rule
- `chittycanon://docs/ops/policy/foundation-charter` (`CHITTYFOUNDATION/chittycanon/FOUNDATION_CHARTER.md`) — DRL, PDX, Loyalty, Baseline Provisioning, Domain Trust, Fission, Grey Matter Principle
- `chittycanon://docs/tech/spec/context-schema` (`CHITTYFOUNDATION/chittycanon/specs/CONTEXT_SCHEMA.md`) — branching strategy, fork/reconcile, lineage continuity threshold, status enum
- `chittycanon://docs/tech/spec/ontology-lifecycle` (`CHITTYFOUNDATION/chittycanon/specs/ONTOLOGY_LIFECYCLE.md`) — term maturity stages
- `chittycanon://core/services/chittyauth`, `chittyverify`, `chittycert`, `chittytrust`, `chittymint`, `chittyproof`, `chittydna`, `chittycypher`/Cypher protocol, `chittyconnect`, `chittyledger`, `chittychronicle`, `chittychain`, `chittycertify`, `chittyscore`, `chittyid`, `chittycanon`

**Reference sources:**
- `CHITTYAPPS/mychitty/docs/specs/mychitty-v1-light-the-substrate.md` — TY/VY/RY operationalization, P-Synthetic continuity, MCP write contract, F-5 substrate continuity
- `CHITTYOS/chittyconnect/docs/governance/CREDENTIAL_OWNERSHIP_LAW.md` — refines this with the 5-role split below
- `CHITTYOS/chittyconnect/docs/governance/SECRETS_MODEL.md` — refines with naming policy and delivery flows
- `CHITTYOS/chittyconnect/docs/canon/ONTOLOGY.md` — System ontology (Service / DataLayer / Composite / Domain / Infrastructure / VersionControl / UnstructuredData / Evidence)

**Phase-0 alignment:** MyChitty is in Phase 0 STOP-GATE. This RFC defines contracts MyChitty's verification packet may rely on. **No code, schema, queue, or service-write changes are introduced by this RFC.** Implementation is gated on (a) MyChitty Phase 0 acceptance, (b) RFC acceptance by named reviewers, (c) doctrine review.

---

## 1. Purpose

Define the single ecosystem-wide standard for:

1. **How any ChittyOS / ChittyApps / FCondos service authorizes a request** (verifier-delegation pattern, no local credential state).
2. **How credentials are issued, attested, custodied, rotated, and revoked** (5-role split aligned to TY/VY/RY).
3. **How an entity's full Context (cognitive + credentials + memory + capabilities + sessions) is resolved per ChittyID** through ChittyConnect, drawing from canonical Tier-0 sources of truth.
4. **How env-var naming, catalog metadata, ledger references, and runtime delivery interlock** so that token *values* never leak into the source-of-truth ledger and code never depends on a specific delivery channel.
5. **How entity-lifecycle events** (fork, graft, fission, supernova, derivative, reconcile, branch, revoke, archive, temporal-decay) **propagate to credential lifecycle**.

This RFC supersedes ad-hoc per-service credential patterns and the issuer-prefixed env-var convention introduced in commit `d944082`. See §6 (Naming Policy Correction).

## 2. Scope, Ontology Declaration, and Out-of-Scope

### 2.1 In scope

- Every service in `CHITTYOS/*`, `CHITTYAPPS/*`, `FURNISHED-CONDOS/*`, and any future ChittyOS-pattern service.
- Every credential type: internal service tokens, MCP gateway tokens, third-party platform tokens (NPM, GitHub, OpenAI, etc.), OAuth credentials, and authority/delegated tokens.

### 2.2 Ontology declaration

Two ontologies apply, composed:

- **Universal Core Ontology** (`chittycanon://gov/governance`): Core Types are *Entity, Thing, Event, Location, Authority* (P/L/T/E/A). All ChittyIDs use this ontology.
- **System Ontology** (`chittycanon://docs/tech/spec/system-ontology`, mirrored at `chittyconnect/docs/canon/ONTOLOGY.md`): Component types are *Service, DataLayer, Composite, Domain, Infrastructure, VersionControl, UnstructuredData, Evidence*. Used to classify ecosystem components.

ChittyConnect-as-component is a *Service*; ChittyConnect-as-entity (with its own ChittyID) is a Synthetic *Entity*. Both classifications coexist.

### 2.3 Out of scope

- Cryptographic primitives of mint operations (ChittyMint internals).
- Cert chain semantics (ChittyCert internals).
- Trust scoring algorithms (ChittyScore / ChittyTrust internals).
- The MyChitty continuity substrate (this RFC defines the contract MyChitty consumes).
- Wire-format API specs for `/auth/*`, `/verify`, `/lifecycle/*`, `/managed-context/*` — those are service-level specs, separate documents.
- DRL reckoning algorithm (Distributed Reputation Ledger compute logic — ChittyTrust / ChittyScore concern).

## 2.5 Architecture at a Glance

The ecosystem composes from clearly-layered roles. Each layer has bounded responsibilities; cross-layer calls follow defined contracts.

### 2.5.1 Layered map

```
Layer 4   Consumers              ledger / register / registry / storage / chain / assets / cases /
                                 evidence / intel / dispute / FCondos·* / ChittyApps·*
                                          (verifier-delegation only; zero local credential state)
                                                            ▲
                                                            │
Layer 3   Orchestration          Ch1tty (mcp.ch1tty.com — programmed shared middleware agent)
                                 myCh1tty (mychitty.com — paid customization layer)
                                                            ▲
                                                            │
Layer 2   Connectivity (VY)      ChittyConnect (interaction — single MCP write contract,
                                                managed.context resolver, broker)
                                 MyChitty (P-Synthetic continuity substrate at chittyapps/mychitty)
                                                            ▲
                                                            │
Layer 1   Authority (RY)         ChittyAuth   (access — login + per-request token /verify)
                                 ChittyCert   (validate — sign certs, host JWKS)
                                 ChittyTrust  (weight — trust resolution, consumes ChittyScore)
          Identity (TY)          ChittyID     (assign ChittyIDs)
                                 ChittyVerify (confirm — identity, evidence-of-identity-origin)
          Domain & Meta          ChittyDispute · ChittyCertify · ChittyGov · ChittySchema · ChittyRegister
                                                            ▲
                                                            │
Layer 0.5 Reckoning Views        DRL — Distributed Reputation Ledger
                                       reckoning (not record), computed at query time over ChittyLedger
                                                            ▲
                                                            │
Layer 0   Primitives             ChittyMint    (process: Minting → Soft-Mint to Ledger | Hard-Mint to Chain)
                                 ChittyProof   (cross-cutting — proves TY/VY/RY claims)
                                 Sovereign double helix:
                                   ChittyDNA   (durable record of patterns/traits/qualities/influence/
                                                attribution/compensation — RECORDABLE strand)
                                   ChittyCypher(portable cypher / runtime protocol — UNLOCKABLE strand)
                                   PDX         (Portable DNA eXchange — formal export/import + proofs spec)
                                 MemoryCloude  (persistent memory)
                                 ChittyLedger  (signed-event spine — Two-Store Rule store #1)
                                 ChittyChronicle (narrative projection)
                                 ChittyChain   (on-chain anchor for Hard-Mint)
                                 ChittyScore   (behavioral scoring engine — feeds ChittyTrust)
                                                            ▲
                                                            │
Layer −1  Canonical Authority    ChittyCanon (P/L/T/E/A ontology, URI namespace, code patterns,
                                              canonical data model, SDK — Two-Store Rule store #2)
                                 ChittyStandards (external standards registry — reference)
```

Cross-cutting: every artifact at every layer is **τ-stamped** (timestamp metadata). τ is metadata, not a fourth aspect — the doctrine has three aspects (TY/VY/RY), period.

### 2.5.2 Canonical service-to-aspect mapping (per `chittycanon://gov/governance`)

| Aspect | Question | Services |
|--------|----------|----------|
| **Identity (TY)** | What IS it? | ChittyID (assign), ChittyVerify (confirm) |
| **Connectivity (VY)** | How does it ACT? | ChittyConnect (interaction) |
| **Authority (RY)** | Where does it SIT? | ChittyAuth (access — including credential verification), ChittyCert (validate), ChittyTrust (weight) |
| **Cross-cutting** | proves any aspect | ChittyProof |

Other services slot at additional layers (primitives, meta-policies, orchestration) without altering the canonical aspect set.

## 3. The 5-Role Split for Credential Operations

`CREDENTIAL_OWNERSHIP_LAW.md` collapses authentication, lifecycle policy, verification, issuance, attestation, and custody. This RFC splits them into five non-overlapping operational roles, all doctrine-aligned. **ChittyAuth (access) absorbs both authentication and credential verification per doctrine** — see §3.2.

### 3.1 Role table

| Role | Service | Responsibility | Aspect | Stateful? |
|------|---------|----------------|--------|-----------|
| **Custodian / Broker / Context Resolver** | **ChittyConnect** | Holds every entity's full Context. Provides single MCP write contract. Resolves `managed.context` per ChittyID. Brokers credential values via 1P / Cloudflare Secrets / KV. Surfaces behavioral state to RY services. | VY | Yes (per-entity) |
| **Access Authority (login + verify)** | **ChittyAuth** | Login (OAuth, MFA, session establishment). Per-request bearer-token verification (`/verify`). Owns credential lifecycle policy. Orchestrates Mint and Cert during issuance. Applies behavioral gating using state surfaced by ChittyConnect. | RY | Yes (sessions, policy, verification audit) |
| **Identity Confirmer** | **ChittyVerify** | Confirms identity claims (entity-of-record matches presenter) and identity-of-origin attestations on evidence. Distinct from token-validity verification. | TY | Yes (verification audit) |
| **Issuer** | **ChittyMint** | Cryptographic minting. Generates the credential value. Two sinks: Soft-Mint → ChittyLedger (off-chain immutability via R2-backed object), Hard-Mint → ChittyChain (on-chain finality). Stateless executor — does not decide *if*, only produces *what*. | RY | No |
| **Attestor** | **ChittyCert** | Signs cert chains on minted credentials. Hosts JWKS at `cert.chitty.cc/.well-known/jwks.json`. Provides attestation primitive consumed by ChittyAuth (verify), ChittyTrust, and any verifier needing signed proof. | RY | Yes (cert registry) |

Plus a **Consumer** archetype for every other service (ChittyLedger, ChittyRegister, ChittyRegistry, ChittyStorage, ChittyChain, ChittyAssets, ChittyCases, ChittyEvidence, ChittyIntel, ChittyDispute, ChittyApps·*, FCondos·*) — receives request with bearer token, delegates verification to ChittyAuth, acts on returned `(entity, scope, valid)`. **Holds zero local credential state.**

### 3.2 Why doctrine collapses authentication and credential-verification at ChittyAuth

The canonical service-to-aspect table in `chittycanon://gov/governance` lists ChittyAuth under RY as "access." Both *establishing* a session (login) and *gating* a per-request operation (verify) are access decisions — they answer "where does this entity SIT relative to this resource?" Operational separation is acceptable as internal modularity (different endpoint groups, different scaling, different audit streams), but the policy authority is one service.

ChittyVerify's role is distinct and TY-scoped: confirm that an entity, evidence record, or credential's claimed *origin identity* matches reality. This is identity-confirmation, not access-decisioning.

### 3.3 Binding rules

1. Consumer services **MUST NOT** maintain local credential databases, token-to-entity mappings, or scope-to-permission tables.
2. Consumer services **MUST** delegate per-request bearer-token verification to **ChittyAuth `/verify`**.
3. ChittyAuth **MUST NOT** mint credential values directly; it delegates to ChittyMint.
4. ChittyAuth **MUST NOT** sign attestations directly; it delegates to ChittyCert.
5. ChittyConnect **MUST NOT** make lifecycle-policy decisions; it asks ChittyAuth.
6. ChittyMint and ChittyCert **MUST NOT** be called directly by consumer services; reachable only via ChittyAuth.
7. ChittyVerify **MUST NOT** be used for token-validity verification — its scope is identity confirmation.
8. ChittyConnect **MAY** be reached directly by entity surfaces (substrates, MyChitty viewports, MCP gateways) for context resolution and credential brokering, with the caller's bearer token verified by ChittyAuth first.

## 4. Verification Flow (universal consumer pattern)

Every consumer service implements the same flow on every authenticated request.

```
1. Caller → Consumer Service:
     Request with `Authorization: Bearer <token>`
     Optional: `X-Chitty-Cypher: <cypher>` for entity-binding proof

2. Consumer Service → ChittyAuth:
     POST /verify
     {
       token:   "<token>",
       cypher:  "<optional entity cypher>",
       intent:  "<verb>:<resource>",     // e.g., "write:event_ledger", "read:case"
       service: "<consumer service name>"
     }

3. ChittyAuth (composing primitives):
     a. ChittyProof.verifyECDSA(token)              — signature integrity
     b. ChittyCert.verifyChain(token.attestation)   — attestation chain valid
     c. (if cypher) ChittyCypher.verifyBinding(cypher, token.entity_chittyid) — entity binding
     d. ChittyConnect.managedContext.lookup(...)    — token in entity's catalog?
     e. scope-match: this token's scope authorizes `intent`?
     f. revocation check
     g. behavioral gate: ChittyConnect.behaviorOK(entity_chittyid, intent)
        — for high-risk intents may also query DRL via Cypher for earned-authority reckoning
     h. Return:
        { valid: true,  entity, scope, attestation_id, expires_at }
        | { valid: false, reason: "revoked"|"scope_mismatch"|"behavior_gate"|"expired"|"cypher_mismatch"|"unknown_token" }

4. Consumer Service:
     valid → proceed; emit reference event to ChittyChronicle (audit projection)
     invalid → 401 (unknown_token, expired) or 403 (scope_mismatch, behavior_gate, revoked, cypher_mismatch)
```

### 4.1 Caching

Consumer services MAY cache `valid: true` verdicts for `min(expires_at, 60s)`. They **MUST NOT** cache `valid: false` verdicts. They **MUST** invalidate on receipt of a `credential.revoked` ledger event for the cached attestation id.

### 4.2 Failure modes

If ChittyAuth is unreachable, consumer services **MUST** fail closed by default. Services flagged `availability_critical: true` in their `CHARTER.md` MAY use a short-lived (≤5min) signed availability fallback issued by ChittyAuth in advance; emergency-only path, emits a chronicle event on every use.

### 4.3 Granted vs Earned authority

The verify response distinguishes **Granted** (the entity holds this scope per managed.context) from **Earned** (DRL reckoning permits this intent). For high-stakes intents, both must concur. ChittyAuth's policy table specifies which intents are `granted-only` vs `granted-and-earned`.

## 5. Issuance Flow (universal credential creation)

```
1. Entity (via MyChitty / substrate / direct service) → ChittyConnect:
     POST /managed-context/credential/request
     {
       entity_chittyid:  "<P|L|T|E|A>-typed id",
       scope:            ["<verb>:<resource>", ...],
       ttl_seconds:      <number>,
       durability:       "soft" | "hard",   // optional — defaults per credential class policy
       purpose:          "<human-readable>",
       requesting_substrate: "<claude-code|openclaw|chatgpt|service:...>"
     }

2. ChittyConnect → ChittyAuth:
     POST /lifecycle/issue (forwards request + ChittyConnect's own minting authority token)

3. ChittyAuth:
     a. policy check (per consumer service issuance rules)
     b. behavioral gate via ChittyConnect.behaviorOK(entity_chittyid, "issue:credential")
     c. if approved:
        i.   ChittyMint.mint({ scope, entity_chittyid, ttl, durability })
                soft → R2-backed Ledger object
                hard → ChittyChain anchor
        ii.  ChittyCert.attest({ value_hash, scope, entity_chittyid, expires_at, cypher_binding })
                attestation_id returned
        iii. ChittyDNA fragment appended (issuance event)
        iv.  ChittyCypher derives updated cypher for entity (if applicable)
     d. Returns { value, attestation_id, expires_at, scope, cypher_update? } to ChittyConnect

4. ChittyConnect:
     a. write value to 1Password (cold)
     b. if delivery target specified, push to Cloudflare Secrets via wrangler API for that worker
     c. append `credential.issued` reference event to ChittyLedger (catalog reference only — NEVER the value)
     d. update entity's managed.context
     e. emit chronicle projection
     f. return { attestation_id, expires_at, delivery, cypher_update? } to caller

5. Entity receives proof of issuance. Raw value delivered only to resolved delivery channel.
```

### 5.1 Delivery channels

Credential value is resolvable through exactly one of:

| Channel | Use | Storage |
|---------|-----|---------|
| **CF Secrets (env)** | Long-lived service credentials needed at worker startup | Cloudflare Secrets (hot), 1P (cold) |
| **Broker response** | Per-request credential surfacing | 1P (cold), KV cache (≤5min, encrypted) |
| **MCP tool resolution** | Surfaced into MCP tool calls via ChittyConnect proxy | 1P (cold), no client-side storage |
| **OAuth token exchange** | Time-limited refresh flows | OAUTH_KV (≤provider expiry) |

Token *values* never enter ChittyLedger, ChittyChronicle, or ChittyDNA. Catalog references and lineage events do.

### 5.2 Soft-Mint vs Hard-Mint (per `chittycanon://gov/governance`)

Doctrine canonical:
- **Soft-Mint** — Committed to Ledger, off-chain immutability. Default for rotating credentials.
- **Hard-Mint** — Anchored to Chain, on-chain finality. Default for genesis tokens, revocation events, root attestations, court-grade claims.

ChittyAuth's lifecycle policy specifies the default durability per credential class. Callers may request a higher level (soft → hard) but never lower for a class whose policy specifies `hard`. Soft → hard promotion is permitted; hard → soft demotion is impossible (chain is permanent).

## 6. Naming Policy Correction

### 6.1 Problem

Commit `d944082` introduced `CHITTYAUTH_ISSUED_<SERVICE>_TOKEN` as the "preferred" env var pattern. This bakes the issuer's name into the variable, treating ChittyAuth specially when the architecture treats it as one role among many. Doesn't extend to external platform credentials (we wouldn't say `GITHUB_ISSUED_REPO_TOKEN`).

### 6.2 Corrected policy

Env var names describe **role + holder**, never the issuer. Issuer is metadata in the catalog.

| Form | Purpose | Examples |
|------|---------|----------|
| `CHITTY<SERVICE>_TOKEN` | Consumer token — holder calls the named service | `CHITTYLEDGER_TOKEN`, `CHITTYCASES_TOKEN`, `CHITTYREGISTER_TOKEN` |
| `CHITTYCONNECT_<ROLE>_TOKEN` | Authority token held by ChittyConnect for a delegated role | `CHITTYCONNECT_MINTING_TOKEN` |
| `<PLATFORM>_<ROLE>_TOKEN` | External platform credential | `NPM_PUBLISH_TOKEN`, `GITHUB_REPO_TOKEN` |
| `CH1TTY_<ROLE>_TOKEN` | Ch1tty gateway token | `CH1TTY_MCP_TOKEN` (already in use) |

Naming grammar (per doctrine `chittycanon://gov/governance`):
- Aspects use abstract nouns (-ity / -ivity) — Identity, Connectivity, Authority
- States use past participles — Frozen, Verified, Earned, Granted, Revoked, Forked
- Qualities use adjectives (-ent / -ant / -ible / -able) — Transparent, Compliant, Portable, Revocable
- Processes use gerunds or nouns — Minting, Verification, Amendment, Rotation
- Structures use singular nouns — Ledger, Chain, Schema, Canon, Cypher

### 6.3 Migration

- `CHITTYAUTH_ISSUED_*` deprecated as preferred form; kept as legacy alias resolved last in `credential-helper.js` precedence with a deprecation warning.
- `MINT_API_KEY` continues as transitional alias for `CHITTYMINT_TOKEN`.
- `CHITTYMINT_SECRET` continues as legacy webhook-only secret (already deprecated for API auth).
- New tokens introduced after RFC acceptance MUST use the corrected forms.

## 7. ContextConsciousness — the per-entity Context

ChittyConnect resolves `Context` for any ChittyID. Context is a faceted view; ChittyConnect is the *composer*, not the primary store for every facet. Sources of truth live at canonical Tier-0 services per the Two-Store Rule (§10.5).

### 7.1 Context shape

```
Context(chittyid) = {
  identity:     { type: "P|L|T|E|A", characterization, jurisdiction, ... }   // sourced from ChittyID
  cognitive:    { dna_pointer }                                                // sourced from ChittyDNA
  cypher:       { current_cypher, version, derived_at }                        // sourced from ChittyCypher
  memory:       MemoryCloude handle                                            // sourced from MemoryCloude
  managed:      { context: { tokens, secrets, keys, vars, attestations } }    // ChittyConnect-resident catalog refs
  capabilities: { archetype, capabilities[], experiments[] }                   // computed view via alchemist daemon
  sessions:     { active[], bindings[] }                                       // ChittyConnect-resident
  rehydration:  { ledger_cursor, last_event_id }                               // sourced from ChittyLedger
  reckoning:    DRL view                                                       // computed via DRL over ChittyLedger
  trust:        { domain_trust: {...}, score: ChittyScore output }             // sourced from ChittyTrust+ChittyScore
}
```

### 7.2 API surface (ChittyConnect)

```
GET  /api/v1/context/:chittyid                      → resolve full Context (auth-gated)
GET  /api/v1/context/:chittyid/credentials          → managed.context facet only
POST /api/v1/context/:chittyid/credential/request   → issuance (§5)
POST /api/v1/context/:chittyid/credential/rotate    → rotation
POST /api/v1/context/:chittyid/credential/revoke    → revocation
GET  /api/v1/context/:chittyid/behavior-gate        → does behavior allow intent?
GET  /api/v1/context/:chittyid/cypher               → current Cypher (entity-self only)
```

All endpoints require ChittyAuth-verified caller.

### 7.3 Behavioral gating contract

Consumer services MAY request explicit gate via `/behavior-gate` for high-risk operations. ChittyAuth MUST apply the same gate during `/verify` for any intent flagged `behavior_gated: true` in policy.

Gate inputs:
- ChittyDNA traits (`volatile`, `compliant`, `creative`, `methodical`, `resilient`, `trustAligned`)
- Recent red flags within configured window
- Source influence profile of recent sessions
- Archetype (Sentinel / Sage / Alchemist / Diplomat / Artisan) vs. operation classification
- DRL earned-authority reckoning (for granted-and-earned intents)

Gate output: `{ pass: boolean, reason: string }`. Decision logged to `context_ledger` regardless of outcome.

## 8. ChittyConnect-as-Entity

ChittyConnect itself has a ChittyID (currently `03-1-USA-5537-P-2602-0-38` per session memory). Its credentials live in its own managed.context. The very first `CHITTYCONNECT_MINTING_TOKEN` is human-bootstrap (the only authorized human-bootstrap exception). After first rotation, the lineage becomes `chittyauth-issued`. The bootstrap event itself is **Hard-Mint** to ChittyChain so the lineage origin is permanent.

## 9. Worked Example — `CHITTYCONNECT_MINTING_TOKEN`

### 9.1 Identity

The credential authorizing ChittyConnect to call ChittyAuth's lifecycle endpoints (`/lifecycle/issue`, `/lifecycle/rotate`, `/lifecycle/revoke`) on behalf of entities. Scope: `request_credential_lifecycle`. Cannot read or write resource data on any service. Cannot mint anything outside the credential lifecycle pathway.

### 9.2 Naming

Canonical env var: `CHITTYCONNECT_MINTING_TOKEN`. Role: minting. Holder: chittyconnect. Issuer: catalog metadata, not the variable name.

### 9.3 Catalog entry (`.github/secret-catalog.json`)

```json
{
  "name": "CHITTYCONNECT_MINTING_TOKEN",
  "source": "1password",
  "vault": "ChittyConnect Only",
  "vault_id": "shl646vf4snnrkx6linyk3yis4",
  "item": "NPM MINTING TOKEN",
  "field": "CHITTYCONNECT_MINTING_TOKEN",
  "rotation_days": 90,
  "self_rotating": true,
  "issuer": "chittyauth",
  "scope": "request_credential_lifecycle",
  "authorizes": [
    "POST chittyauth /lifecycle/issue",
    "POST chittyauth /lifecycle/rotate",
    "POST chittyauth /lifecycle/revoke"
  ],
  "cannot_read_or_write_resource_data": true,
  "runtime_delivery": "cloudflare-secrets",
  "lineage": "human-bootstrap → chittyauth-issued (after first rotation)",
  "default_durability": {
    "genesis": "hard",
    "first_rotation_handoff": "hard",
    "steady_state_rotation": "soft",
    "revocation": "hard"
  },
  "provisioner": "chittyconnect (writes to 1P + CF Secrets of self)",
  "consumed_by": "chittyconnect-self"
}
```

### 9.4 Lifecycle

- **Genesis** (one-time, human-bootstrap) → **Hard-Mint** to ChittyChain. Permanent record of "this token, attested by cert X, was the genesis mint authority for chittyconnect-self at time T."
- **First rotation** (genesis → chittyauth-issued handoff) → **Hard-Mint**. Lineage transition is one-time and permanent.
- **Steady-state 90-day rotations** → **Soft-Mint** to ChittyLedger. Routine; R2-backed Ledger record sufficient.
- **Revocation** (if ever) → **Hard-Mint**. Permanent on-chain revocation record.

### 9.5 Read / write tokens are separate

R and W capabilities for any consumer service are distinct credentials issued through §5. The minting token can request issuance; it can never serve as one of them. ChittyAuth scope-checking enforces — `request_credential_lifecycle` does not authorize any `read:*` or `write:*` intent.

## 10. Secrets Storage Topology and Two-Store Rule

### 10.1 Storage layers

| Layer | Role | Lifetime | Stores |
|-------|------|----------|--------|
| **1Password** | Cold source-of-truth for every credential value | indefinite | values + provenance metadata |
| **Cloudflare Secrets Store** | Hot runtime delivery into worker `env` | per-deploy | values |
| **KV (`CREDENTIAL_CACHE`)** | Short-lived encrypted broker cache | ≤5min | encrypted values + TTL |
| **ChittyLedger** | Two-Store Rule store #1 — per-entity events | indefinite | catalog references, lineage events, attestation ids — **never values** |
| **ChittyDNA** | Tier-0 sovereign record — patterns/traits/influence/attribution | indefinite | DNA fragments — **never values** |
| **ChittyCanon** | Two-Store Rule store #2 — shared policy and registries | indefinite | credential schemas, scope vocabularies, rotation defaults — **never values** |

### 10.2 Two-Store Rule (per `chittycanon://gov/governance`)

> *"All persistent state in the ecosystem lives in exactly two stores: ChittyLedger (per-entity) and ChittyCanon (shared)."*

- **State** (lineage events, policies, schemas) → ChittyLedger or ChittyCanon. No exceptions.
- **Secrets** (token values) → 1P + Cloudflare Secrets + KV-cache. Not "state" in the canonical sense; values are delivery artifacts.
- **KV** is cache only, ≤5min TTL. Never source of truth.
- **Local files** are offline fallback. Never source of truth.

The distinction between *state* and *secret* is normative: the Two-Store Rule governs state; secrets follow a separate, well-defined delivery pipeline.

## 11. MyChitty Alignment

This RFC defines the contract MyChitty's "single ChittyConnect/MCP write contract" composes against:

- MyChitty writes signed events through ChittyConnect's MCP write contract.
- Credential lifecycle events (`credential.issued`, `credential.rotated`, `credential.revoked`) are part of the event taxonomy MyChitty's substrates can produce.
- Rehydration from `event_ledger` reconstructs the entity's managed.context references; ChittyConnect resolves values at access time.
- Behavioral gating reads behavior facet rehydrated from the same event spine.
- Per-substrate continuity uses Cypher (carried) + DNA (rehydrated) — substrates remain light, the spine carries weight.

MyChitty Phase 0 verification packet **MAY** cite this RFC as the reference contract for credential events.

## 11.5 Entity Lifecycle Events and Credential Implications

Per `chittycanon://gov/governance` "Sessions Are Viewports, Not Births" + `chittycanon://docs/tech/spec/context-schema` branching strategy, entities transit a git-like lifecycle. Each event has defined credential implications.

### 11.5.1 Lifecycle event taxonomy

| Event | Doctrine source | Git analog | Credential implication |
|-------|-----------------|-----------|-----------------------|
| **Mint** | GOVERNANCE.md §"Minting triggers" | `git init` | New ChittyID (Fission, Derivative, Temporal-decay, or Meta-orchestrator decision only) — fresh Baseline Provisioning credentials |
| **Session** | GOVERNANCE.md §"Sessions Are Viewports" | `git checkout` | Viewport into existing entity — no credential issuance, only resolution |
| **Branch** | CONTEXT_SCHEMA.md §"Branching Strategy" | `git branch` | Neon autobranch (offline >30min); credentials carry over read-only |
| **Reconcile** | CONTEXT_SCHEMA.md | `git merge` | Small-divergence merge; credentials unchanged |
| **Fork** | GOVERNANCE.md, `context_forks` table | `git fork` | Persistent divergence; child gets read-only credential copies, write-tokens minted fresh |
| **Fork → New Entity** | CONTEXT_SCHEMA.md "If merge fails, fork becomes new entity" | `git fork` + `git init` | New ChittyID; new entity issues fresh credentials |
| **Graft** | GOVERNANCE.md (Stem Cell terminology) | upstream PR | Fork returns; re-certification cycle; credentials re-attested |
| **Derivative** | GOVERNANCE.md "Stem Cell / Derivative" | `git clone` from template | Fresh issuance scoped to new domain; lineage cites parent's DNA fragment |
| **Fission** | FOUNDATION_CHARTER §207 "fission is the commercial event" | (split into two repos) | All parent credentials revoked at fission moment (Hard-Mint revocation); two new entities issue fresh |
| **Supernova** | ChittyConnect intelligence layer | `git merge --octopus` | Both contributor credentials revoked at merge; consolidated entity issues fresh |
| **Suspension** | ChittyConnect intelligence layer | (no clean analog) | Temporary blend; credentials suspended, not revoked |
| **Solution / Combination** | ChittyConnect intelligence layer | (collaboration patterns) | No credential change; usage events logged for compensation routing |
| **Revoke** | CONTEXT_SCHEMA.md status enum | `git tag --revoke` | Entity removed; all credentials Hard-Mint revoked |
| **Archive** | CONTEXT_SCHEMA.md status enum | `git archive` | Long-term dormancy; credentials suspended (not revoked); reactivation requires lifecycle event |
| **Temporal decay** | GOVERNANCE.md minting trigger | (graveyard) | Dormancy beyond reconstitution threshold (2hr / 200-tool-use); credentials Hard-Mint revoked; new entity required |

### 11.5.2 Lineage continuity threshold

Per `chittycanon://docs/tech/spec/context-schema`:

> *"A context that cannot prove lineage continuity within 2 hours OR 200 tool uses is no longer presumed to be the same entity and must either Reconcile (if divergence is small) or Become a new entity (if divergence is large)."*

The credential layer enforces: token verification fails with `lineage_continuity_lost` if the presenting context exceeds the threshold without a lineage proof. The entity must Reconcile (re-establish continuity) or be re-classified as a Fork → New Entity, with its credentials handled per §11.5.1.

### 11.5.3 Status enum (canonical)

`active | dormant | archived | revoked | forked` — per `CONTEXT_SCHEMA.md`. Credentials honor the status:

- `active` — credentials valid per scope
- `dormant` — credentials valid but emit warning on use
- `archived` — credentials suspended; reactivation needed
- `revoked` — all credentials Hard-Mint revoked
- `forked` — credentials read-only-copied; write tokens require fresh issuance

## 12. Migration Path

This RFC is a contract definition, not a refactor. Migration happens incrementally:

1. **Acceptance** — sign-off by ChittyAuth, ChittyMint, ChittyCert, ChittyConnect, ChittyVerify maintainers + ecosystem stewards.
2. **Term-lifecycle progression** (per `chittycanon://docs/tech/spec/ontology-lifecycle`): PROPOSED → SIMULATED → PROVISIONAL → PROVEN → CANONICAL.
3. **Promote to canon** — register at `chittycanon://docs/gov/spec/managed-context`.
4. **ChittyConnect first** — implement §7 API surface and §5 issuance flow against ChittyAuth lifecycle endpoints.
5. **ChittyAuth alignment** — `/verify` adds §4 contract shape; lifecycle endpoints add §5 contract; behavioral gate integration with ChittyConnect.
6. **Consumer adoption** — services migrate to verifier-delegation pattern one at a time. Each migration removes local credential state.
7. **Naming sweep** — `CHITTYAUTH_ISSUED_*` env vars renamed to `CHITTY<SERVICE>_TOKEN` form; `credential-helper.js` precedence inverted.
8. **`CHITTYCONNECT_MINTING_TOKEN`** — provisioned through this contract on first rotation; §9 worked example serves as integration test.
9. **Lifecycle event integration** — ChittyConnect's existing intelligence layer endpoints (`/api/v1/intelligence/supernova`, `/fission`, etc.) gain credential-implication side effects per §11.5.

## 13. Open Questions

1. **Behavior facet for non-Person entities.** L/T/E/A entity types lack rich behavioral DNA. Does the gate degrade to identity + capability checks, or are there new gating signals for non-P types?
2. **Cross-entity delegation chains.** When entity A acts on behalf of entity B, does the credential hold A's id, B's id, or a delegation cert? Suggest delegation cert; needs ChittyCert design input.
3. **Genesis exceptions beyond ChittyConnect.** ChittyAuth itself bootstraps somehow. Is its bootstrap a documented genesis exception, or does it use a different out-of-band primitive?
4. **Tenant-scoped managed.contexts.** For multi-tenant services, does each tenant get its own managed.context, or is tenancy a scope inside a service-level context? Impacts FCondos especially.
5. **Cert rotation independence.** Can a cert be rotated without rotating the credential value, or are they always coupled? Affects long-lived credentials with short cert TTLs.
6. **DRL `[RECONSIDER]` authorization.** Anyone can append a reconsideration, but not all should weigh equally. Who can issue `[RECONSIDER]` against whose ledger? Likely lives in ChittyTrust/ChittyAuth policy.
7. **MyChitty vs myCh1tty disambiguation.** `MyChitty` (chittyapps/mychitty — Phase 0 continuity substrate) vs `myCh1tty` (mychitty.com — paid customization layer). Same pronunciation, different concerns. Worth a glossary entry in ChittyCanon.
8. **Fission credential continuity.** When an entity fissions, do *any* credentials carry to the new entities, or is it always full revocation + fresh issuance? §11.5 says full revocation; verify with FOUNDATION_CHARTER reviewers.
9. **PDX vs Cypher boundary.** PDX (formal export/import + proofs spec) vs Cypher (runtime protocol). Where exactly is the line, and how do they compose? Needs ChittyDNA maintainer input.

## 14. Non-Goals

This RFC does not:
- Define ChittyMint's cryptographic primitives.
- Define ChittyCert's signature algorithms or chain semantics.
- Define ChittyTrust / ChittyScore scoring math.
- Specify wire formats for `/verify`, `/lifecycle/*`, `/managed-context/*`.
- Define the DRL reckoning compute algorithm.
- Require any production code change before Phase 0 sign-off and RFC acceptance.
- Add a fourth aspect to TY/VY/RY (the doctrine has three; τ is metadata, not an aspect).

## 15. Doctrine Compliance Statement

This RFC has been validated against:

| Item | Source | Status |
|------|--------|--------|
| Three Aspects (TY/VY/RY) framework | `chittycanon://gov/governance` | ✅ aligned |
| Service-to-aspect mapping | GOVERNANCE.md §"Services by Aspect" | ✅ aligned |
| ChittyAuth = access (login + verify) | GOVERNANCE.md | ✅ aligned (resolves option 1/2/3) |
| ChittyVerify = identity confirm (TY) | GOVERNANCE.md | ✅ aligned (corrected from drift) |
| ChittyProof cross-cutting | GOVERNANCE.md | ✅ aligned |
| Soft-Mint / Hard-Mint canonical terminology | GOVERNANCE.md §"Definitions" | ✅ aligned |
| Granted vs Earned authority | GOVERNANCE.md §"Definitions" | ✅ aligned |
| 5 Core Types (P/L/T/E/A) | GOVERNANCE.md §"Core Types" | ✅ aligned |
| Sessions Are Viewports, Not Births | GOVERNANCE.md §"Binding Operational Rules" | ✅ aligned |
| Two-Store Rule | GOVERNANCE.md §"Two-Store Rule" | ✅ aligned (with state/secret distinction) |
| Lineage continuity threshold (2hr / 200-tool-use) | CONTEXT_SCHEMA.md | ✅ integrated (§11.5.2) |
| Entity lifecycle events (fork/graft/fission/supernova/...) | GOVERNANCE.md, CONTEXT_SCHEMA.md, FOUNDATION_CHARTER.md | ✅ integrated (§11.5) |
| Universal vs System ontology | GOVERNANCE.md, ONTOLOGY.md | ✅ declared (§2.2) |
| Term lifecycle for this RFC | ONTOLOGY_LIFECYCLE.md | ✅ marked PROPOSED |
| Naming grammar (Aspects/States/Qualities/Processes/Structures) | GOVERNANCE.md §"Grammatical Alignment Rule" | ✅ §6.2 conforms |
| τ as fourth aspect | doctrine has three only | ❌ rejected — τ is metadata |
| Grey Matter Principle | FOUNDATION_CHARTER.md | ✅ honored (substrates are light, spine is heavy) |

---

**End of RFC v0.3**

Reviewers requested:
- ChittyAuth maintainers (lifecycle endpoint shape, /verify contract)
- ChittyMint maintainers (issuer interface, soft/hard durability sinks)
- ChittyCert maintainers (attestation interface, JWKS contract)
- ChittyVerify maintainers (TY scope confirmation; clarify identity-of-origin charter)
- ChittyConnect maintainers (custodian responsibilities, ContextConsciousness API)
- ChittyDNA maintainers (DNA fragment append on issuance, Cypher derivation)
- ChittyCanon stewards (term-lifecycle progression, doctrine alignment)
- MyChitty Phase-0 reviewers (contract compatibility)
- ChittyTrust + ChittyScore maintainers (DRL reckoning interface, behavioral gate signals)
