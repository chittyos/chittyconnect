---
uri: chittycanon://docs/ops/policy/chittyconnect-charter
namespace: chittycanon://docs/ops
type: policy
version: 1.0.0
status: CERTIFIED
registered_with: chittycanon://core/services/canon
title: "ChittyConnect Charter"
certifier: chittycanon://core/services/chittycertify
visibility: PUBLIC
---

# ChittyConnect Charter

## Classification
- **Canonical URI**: `chittycanon://core/services/chittyconnect`
- **Tier**: 2 (Platform)
- **Organization**: CHITTYOS
- **Domain**: connect.chitty.cc

## Mission

ChittyConnect is the **AI-intelligent spine** (itsChitty™) for the ChittyOS ecosystem with ContextConsciousness™ and MemoryCloude™. It provides the comprehensive connector enabling custom GPTs, Claude, and third-party integrations to interact with the entire ChittyOS ecosystem.

## Scope

### IS Responsible For
- Custom GPT Actions API with OpenAPI specification
- MCP (Model Context Protocol) server for Claude integration
- GitHub App integration with fast-ack webhook processing
- Third-party integration proxy (Notion, OpenAI, Neon, Google Calendar, Cloudflare AI)
- ContextConsciousness™ - Cross-session context maintenance
- MemoryCloude™ - Persistent memory for Claude interactions
- Service health monitoring across ChittyOS ecosystem
- API key management and rate limiting
- ChittyID minting coordination
- Legal case management via ChittyCases
- Evidence ingestion via ChittyEvidence
- **User profile store** — canonical writer for `neon_auth.user`,
  `neon_auth.account`, `neon_auth.session`, `neon_auth.verification` on
  Neon project `restless-grass-40598426` (ChittyOS-Core). Validates inbound
  Bearer JWTs against the ChittyAuth JWKS (`auth.chitty.cc`) and applies
  RLS bound to the verified `sub` (ChittyID DID). See
  `src/auth/neon-user-store.js` and `migrations/019_neon_auth_user_store.sql`.
- **Multi-tenant org membership** — canonical writer for
  `neon_auth.organization`, `neon_auth.member`, `neon_auth.invitation`. Per-org
  RLS predicates derive from the caller's membership rows.

> **Neon Auth ownership split (binding).** ChittyConnect owns the seven
> tables enumerated above; **ChittyAuth** owns `neon_auth.jwks` and
> `neon_auth.project_config` per `chittyauth/CHARTER.md:60-84` and the canon
> proposal `chittycanon://proposal/neon-auth-ownership-split`. This service
> does NOT write to `jwks` or `project_config` under any circumstance.

### IS NOT Responsible For
- Direct identity generation (ChittyID)
- Token provisioning (ChittyAuth)
- Service registration (ChittyRegister)
- Certificate authority (ChittyTrust)
- Evidence verification (ChittyVerify)
- Event storage (ChittyChronicle)

## Three Interfaces

### 1. REST API (Custom GPT Actions)
- OpenAPI 3.0 specification at `/openapi.json`
- ChittyOS service proxying
- Third-party API unification

### 2. MCP Server (Claude Integration)
- Model Context Protocol tools
- Real-time resource access
- ContextConsciousness™ state

### 3. GitHub App
- Fast-ack webhook processing
- MCP normalization
- Issue/PR automation

## Dependencies

| Type | Service | Purpose |
|------|---------|---------|
| Upstream | ChittyID | Identity minting |
| Upstream | ChittyAuth | Token validation |
| Upstream | ChittyRegistry | Service discovery |
| Peer | ChittyChronicle | Event logging |
| Peer | ChittyFinance | Banking integrations |
| Peer | ChittyCases | Case management |
| Peer | ChittyEvidence | Evidence management |
| Peer | ChittyLedger | Transaction recording |
| External | Notion API | Database operations |
| External | OpenAI API | Chat completions |
| External | Google Calendar | Event management |
| External | Neon Database | SQL queries |

## API Contract

**Base URL**: https://connect.chitty.cc

### Core Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Service health |
| `/openapi.json` | GET | OpenAPI specification |
| `/api/chittyid/mint` | POST | Mint ChittyID |
| `/api/chittyid/validate` | POST | Validate ChittyID |
| `/api/services/status` | GET | All services status |
| `/api/thirdparty/notion/query` | POST | Query Notion |
| `/api/thirdparty/openai/chat` | POST | OpenAI proxy |

### MCP Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/mcp/manifest` | GET | Server manifest |
| `/mcp/tools/list` | GET | Available tools |
| `/mcp/tools/call` | POST | Execute tool |
| `/mcp/resources/list` | GET | Available resources |
| `/mcp/resources/read` | GET | Read resource |

### MCP Tools Available
- `chittyid_mint` - Mint ChittyIDs with context
- `chitty_contextual_analyze` - ContextConsciousness™ analysis
- `chitty_case_create` - Create legal cases
- `chitty_evidence_ingest` - Ingest evidence
- `chitty_services_status` - Monitor ecosystem health
- `chitty_finance_connect_bank` - Connect banking

> **Note (2026-06):** Prior revisions of this CHARTER proposed adding `git_commit`,
> `git_push`, `git_tag` as MCP tools here. That framing is **withdrawn**.
> ChittyConnect is a **broker** (authorization server + credential broker), not an
> MCP tool host. All `git_*` MCP tools (read and write) live on `chittyagent-git`
> (the resource server). ChittyConnect exposes **REST broker primitives** that the
> resource server calls into. See "Git Broker Surface (REST, sensitive)" below.
>
> The legacy `/mcp/*` endpoints on this service are deprecated and slated for
> removal; do not extend them.

### Git Broker Surface (REST, sensitive) — SPEC

> **Status: SPEC** — these REST broker primitives are NOT YET IMPLEMENTED.
> Implementation tracked in chittyos/chittyconnect#209.
>
> **Architecture (binding).** ChittyConnect is an **authorization server +
> credential broker**, not an MCP tool host. The MCP surface for git lives on
> `chittyagent-git` (the resource server, Cloudflare Worker in `chittyentity`),
> which exposes ALL git tools — both read (`git_status`, `git_log`, `git_diff`,
> `git_show`, `git_blame`, `git_branch_list`) and write (`git_commit`,
> `git_push`, `git_tag`). `chittymcp` / `ch1tty` federate that worker for
> discovery + transport but carry no policy.
>
> The endpoints below are the broker primitives the resource server calls
> *back* into. ChittyConnect never sits on the client→worker call path:
> the client carries a capability token, the worker validates it here and
> requests signing / ledger emission as needed.
>
> **Signing is mandatory and non-overridable** for commit and tag operations.
> Signing keys are resolved from 1Password and never leave the broker; only
> the produced signature is returned.

#### `[SPEC] POST /api/v1/capabilities/mint`

Mint a short-TTL capability token scoped to a single caller × tenant × repo ×
operation × ref. Tokens are opaque to clients; their claims are obtained via
`introspect`. Capabilities are bound to a granular `operation`
(`read | commit | tag | push`) and MAY NOT be reused for a different action —
a `commit` capability cannot sign a tag or emit a push event. For
`operation = "push"` with `force_class != "none"`, a fresh confirmation token
from `/api/v1/capabilities/confirm` is required.

```json
{
  "name": "capabilities.mint",
  "input_schema": {
    "type": "object",
    "required": ["caller_chittyid", "tenant_id", "operation", "repo_path"],
    "additionalProperties": false,
    "properties": {
      "caller_chittyid":    { "type": "string", "pattern": "^[A-Z0-9]{2}-[A-Z0-9]-[A-Z0-9]{3}-[A-Z0-9]{4}-[PLTEA]-[0-9]{4}-[0-5]-[0-9]{2}$", "description": "Canonical ChittyID VV-G-LLL-SSSS-T-YYMM-C-XX per chittycanon://gov/governance. T in {P,L,T,E,A}; YYMM is year-month; C is trust level 0-5; XX is mod-97 checksum." },
      "tenant_id":          { "type": "string", "minLength": 1, "maxLength": 128 },
      "operation":          { "type": "string", "enum": ["read", "commit", "tag", "push"] },
      "repo_path":          { "type": "string", "minLength": 1, "description": "Absolute path; validated against tenant repo allowlist." },
      "remote":             { "type": "string", "description": "Required when operation='push'." },
      "ref":                { "type": "string", "description": "Required when operation ∈ {commit, tag, push}. Concrete ref (e.g. refs/heads/main, refs/tags/v1.2.3) the capability binds to." },
      "force_class":        { "type": "string", "enum": ["none", "force", "force_with_lease"], "default": "none" },
      "confirmation_token": { "type": "string", "description": "Required when operation='push' AND force_class != 'none'." }
    },
    "allOf": [
      {
        "if": {
          "properties": { "operation": { "enum": ["commit", "tag", "push"] } },
          "required": ["operation"]
        },
        "then": { "required": ["ref"] }
      },
      {
        "if": {
          "properties": { "operation": { "const": "push" } },
          "required": ["operation"]
        },
        "then": { "required": ["remote"] }
      },
      {
        "if": {
          "properties": { "force_class": { "enum": ["force", "force_with_lease"] } },
          "required": ["force_class"]
        },
        "then": { "required": ["confirmation_token"] }
      }
    ]
  },
  "output_schema": {
    "type": "object",
    "required": ["token", "token_type", "expires_at", "scope"],
    "additionalProperties": false,
    "properties": {
      "token":      { "type": "string", "description": "Opaque capability token. MUST NOT be logged or echoed in error envelopes." },
      "token_type": { "type": "string", "const": "chittyconnect-capability" },
      "expires_at": { "type": "string", "format": "date-time", "description": "TTL <= 300s." },
      "scope": {
        "type": "object",
        "required": ["caller_chittyid", "tenant_id", "operation", "repo_path"],
        "additionalProperties": false,
        "properties": {
          "caller_chittyid": { "type": "string" },
          "tenant_id":       { "type": "string" },
          "operation":       { "type": "string", "enum": ["read", "commit", "tag", "push"] },
          "repo_path":       { "type": "string" },
          "remote":          { "type": "string" },
          "ref":             { "type": "string" },
          "force_class":     { "type": "string", "enum": ["none", "force", "force_with_lease"] }
        }
      }
    }
  }
}
```

#### `[SPEC] POST /api/v1/capabilities/introspect`

Validate a capability token and return its claims. Resource servers
(`chittyagent-git`) call this on every inbound request before performing any
git operation. Fail-closed if unreachable.

```json
{
  "name": "capabilities.introspect",
  "input_schema": {
    "type": "object",
    "required": ["token"],
    "additionalProperties": false,
    "properties": { "token": { "type": "string" } }
  },
  "output_schema": {
    "type": "object",
    "required": ["active"],
    "additionalProperties": false,
    "properties": {
      "active":     { "type": "boolean" },
      "expires_at": { "type": "string", "format": "date-time" },
      "scope": {
        "type": "object",
        "required": ["caller_chittyid", "tenant_id", "operation", "repo_path", "remote", "force_class"],
        "additionalProperties": false,
        "properties": {
          "caller_chittyid": { "type": "string" },
          "tenant_id":       { "type": "string" },
          "operation":       { "type": "string", "enum": ["read", "commit", "tag", "push"] },
          "repo_path":       { "type": "string" },
          "remote":          { "type": "string" },
          "ref":             { "type": "string" },
          "force_class":     { "type": "string", "enum": ["none", "force", "force_with_lease"] }
        }
      }
    },
    "if":   { "properties": { "active": { "const": true } }, "required": ["active"] },
    "then": { "required": ["scope"] }
  }
}
```

#### `[SPEC] POST /api/v1/capabilities/confirm`

Issue a short-TTL confirmation token. Required as a second factor before
minting a capability with `force_class != "none"`. Confirmation tokens are
single-use and bound to caller+tenant+repo+remote+ref+force_class. A
confirmation issued for one (`remote`, `ref`) pair (e.g. `origin` +
`refs/heads/feature`) CANNOT be redeemed to force-push a different ref
(e.g. `refs/heads/main`) — the resource server MUST reject scope-mismatched
tokens with `POLICY_BLOCKED_CONFIRMATION_INVALID`.

```json
{
  "name": "capabilities.confirm",
  "input_schema": {
    "type": "object",
    "required": ["caller_chittyid", "tenant_id", "repo_path", "remote", "ref", "force_class"],
    "additionalProperties": false,
    "properties": {
      "caller_chittyid": { "type": "string" },
      "tenant_id":       { "type": "string" },
      "repo_path":       { "type": "string" },
      "remote":          { "type": "string", "description": "Remote the confirmation authorizes (e.g. 'origin')." },
      "ref":             { "type": "string", "description": "Concrete ref the confirmation authorizes (e.g. refs/heads/feature). NOT interchangeable across refs." },
      "force_class":     { "type": "string", "enum": ["force", "force_with_lease"] }
    }
  },
  "output_schema": {
    "type": "object",
    "required": ["confirmation_token", "expires_at", "bound_scope"],
    "additionalProperties": false,
    "properties": {
      "confirmation_token": { "type": "string" },
      "expires_at":         { "type": "string", "format": "date-time", "description": "TTL <= 120s." },
      "bound_scope": {
        "type": "object",
        "required": ["caller_chittyid", "tenant_id", "repo_path", "remote", "ref", "force_class"],
        "additionalProperties": false,
        "properties": {
          "caller_chittyid": { "type": "string" },
          "tenant_id":       { "type": "string" },
          "repo_path":       { "type": "string" },
          "remote":          { "type": "string" },
          "ref":             { "type": "string" },
          "force_class":     { "type": "string", "enum": ["force", "force_with_lease"] }
        },
        "description": "Echo of the exact (caller, tenant, repo, remote, ref, force_class) tuple this token binds to. Mint MUST reject if any field differs."
      }
    }
  }
}
```

#### `[SPEC] POST /api/v1/signing/sign-commit`

Produce a detached signature over the canonical commit payload supplied by the
resource server. The signing key (resolved from 1Password by the broker) never
leaves ChittyConnect. The resource server MUST present a valid capability
token whose scope satisfies `operation="commit"` and matches `repo_path` and `ref`. A capability minted for `tag` or `push` is rejected.

```json
{
  "name": "signing.sign-commit",
  "input_schema": {
    "type": "object",
    "required": ["capability_token", "repo_path", "commit_payload"],
    "additionalProperties": false,
    "properties": {
      "capability_token": { "type": "string" },
      "repo_path":        { "type": "string" },
      "commit_payload":   { "type": "string", "description": "Canonical pre-signature commit object bytes (tree, parents, author, committer, message), base64-encoded." }
    }
  },
  "output_schema": {
    "type": "object",
    "required": ["signature", "key_fingerprint"],
    "additionalProperties": false,
    "properties": {
      "signature":       { "type": "string", "description": "ASCII-armored signature block." },
      "key_fingerprint": { "type": "string", "pattern": "^[0-9a-f]{64}$", "description": "SHA-256 hex digest of the signing public key. Non-sensitive identifier; safe to log. The actual signing key reference (op:// path / 1Password UUID) is broker-internal and MUST NEVER appear in any response, ledger payload, or error envelope." }
    }
  }
}
```

#### `[SPEC] POST /api/v1/signing/sign-tag`

Same shape as `sign-commit` but signs an annotated-tag object payload. The presented capability MUST have `operation="tag"` and matching `repo_path` + `ref`; capabilities for `commit` or `push` are rejected.

```json
{
  "name": "signing.sign-tag",
  "input_schema": {
    "type": "object",
    "required": ["capability_token", "repo_path", "tag_payload"],
    "additionalProperties": false,
    "properties": {
      "capability_token": { "type": "string" },
      "repo_path":        { "type": "string" },
      "tag_payload":      { "type": "string", "description": "Canonical pre-signature tag object bytes, base64-encoded." }
    }
  },
  "output_schema": {
    "type": "object",
    "required": ["signature", "key_fingerprint"],
    "additionalProperties": false,
    "properties": {
      "signature":       { "type": "string" },
      "key_fingerprint": { "type": "string", "pattern": "^[0-9a-f]{64}$", "description": "SHA-256 hex digest of the signing public key. Non-sensitive; safe to log." }
    }
  }
}
```

#### `[SPEC] POST /api/v1/policy/resolve`

Resolve tenant policy: allowed repos, allowed remotes, force-push gates,
default author identity. Called by the resource server during admission.

```json
{
  "name": "policy.resolve",
  "input_schema": {
    "type": "object",
    "required": ["tenant_id", "caller_chittyid", "operation"],
    "additionalProperties": false,
    "properties": {
      "tenant_id":       { "type": "string" },
      "caller_chittyid": { "type": "string" },
      "operation":       { "type": "string", "enum": ["read", "commit", "tag", "push"] }
    }
  },
  "output_schema": {
    "type": "object",
    "required": ["allowed_repos", "allowed_remotes", "force_push_allowed", "protected_branches"],
    "additionalProperties": false,
    "properties": {
      "allowed_repos":      { "type": "array", "items": { "type": "string" }, "description": "Absolute path globs." },
      "allowed_remotes":    { "type": "array", "items": { "type": "string" }, "description": "URL globs (e.g. github.com/CHITTYOS/*)." },
      "force_push_allowed": { "type": "boolean" },
      "protected_branches": { "type": "array", "items": { "type": "string" }, "description": "Branches where force-push is hard-denied regardless of confirmation." },
      "default_author":     { "type": "string", "description": "'Name <email>' applied when caller does not override." }
    }
  }
}
```

#### `[SPEC] POST /api/v1/ledger/emit`

Emit a domain-tagged ChittyLedger event from the resource server. Returns the
ledger entry hash for inclusion in the resource server's response to the
client. Domain tag is fixed to `git` on this surface.

```json
{
  "name": "ledger.emit",
  "input_schema": {
    "type": "object",
    "required": ["capability_token", "event_type", "payload"],
    "additionalProperties": false,
    "properties": {
      "capability_token": { "type": "string" },
      "event_type":       { "type": "string", "enum": ["git.commit", "git.push", "git.tag"] },
      "payload": {
        "type": "object",
        "description": "Event-specific fields (commit_sha, pushed_refs, tag_name, etc.). MUST NOT contain raw remote URLs with userinfo or raw git stderr — apply the redaction contract before submitting."
      }
    }
  },
  "output_schema": {
    "type": "object",
    "required": ["ledger_event_id", "entry_hash", "domain"],
    "additionalProperties": false,
    "properties": {
      "ledger_event_id": { "type": "string" },
      "entry_hash":      { "type": "string", "description": "Hex sha256 of the canonicalized entry." },
      "domain":          { "type": "string", "const": "git" }
    }
  }
}
```

#### Policy gates (binding)

1. **Signing key** — resolved from 1Password via `op://` reference per the sensitive-intent contract. Never read from env vars, disk, or chat. Signing is mandatory for commit and tag flows; broker exposes no disable knob. If 1Password is unreachable → fail closed.
2. **Remote allowlist** — per-tenant config returned by `policy.resolve`. Default: `github.com/CHITTYOS/*`, `github.com/CHITTYFOUNDATION/*`. Resource server MUST refuse push to non-allowlisted remotes → `POLICY_BLOCKED_REMOTE_NOT_ALLOWED`.
3. **Repo allowlist** — per-tenant. Resource server MUST refuse repos outside the list → `POLICY_BLOCKED_REPO_NOT_ALLOWED`.
4. **Force-push guard** — minting a capability with `force_class != "none"` requires a fresh `confirmation_token` from `/api/v1/capabilities/confirm`. Confirmation tokens are single-use and bound to (caller, tenant, repo, force_class). Force-push to any branch in `protected_branches` is hard-denied regardless of token → `POLICY_BLOCKED_FORCE_TO_PROTECTED`. `force` and `force_with_lease` are distinct values of `force_class` — they cannot be combined.
5. **Audit** — every successful write requires the resource server to call `/api/v1/ledger/emit`. The returned `ledger_event_id` is included in the response to the client. Domain tag is `git`, hash-chained per the canonical projection model.
6. **Broker liveness** — if the broker is unreachable from the resource server, the resource server fails closed with `POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE`. No local fallback.
7. **Credential redaction (binding contract)** — any string the resource server places in a `ledger.emit` payload or any error envelope it returns to the client MUST pass through a redaction filter:
   - URL userinfo: strip the `userinfo` component from any URL, rewriting `https?://[^@]+@` to scheme-only `https?://`. Applies to remote URLs and any URL in error messages.
   - CLI output: omit raw `git` stdout/stderr from error envelopes, or pass it through the userinfo strip plus a token-pattern scrub (`gh[pousr]_[A-Za-z0-9_]{20,}`, `github_pat_[A-Za-z0-9_]{20,}`, `xox[bpars]-[A-Za-z0-9-]{10,}`, 40+ char hex/base64 secrets adjacent to `://` or `Authorization:`). When in doubt, omit.
   - Capability tokens, confirmation tokens, signatures, and signing-key references (op:// paths, 1Password UUIDs, secret names, env-var names referencing keys) MUST NEVER appear in any broker response (including `/signing/*` outputs), ledger payloads, or error envelopes. Only the non-sensitive `key_fingerprint` (sha256 of the public key) is exported.

#### Error codes

| Code | Meaning |
|------|---------|
| `POLICY_BLOCKED_REPO_NOT_ALLOWED` | `repo_path` not in tenant repo allowlist |
| `POLICY_BLOCKED_REMOTE_NOT_ALLOWED` | Remote URL not in tenant allowlist |
| `POLICY_BLOCKED_FORCE_TO_PROTECTED` | Force-push attempted against protected branch |
| `POLICY_BLOCKED_CONFIRMATION_REQUIRED` | `force_class != "none"` without valid `confirmation_token` |
| `POLICY_BLOCKED_CONFIRMATION_INVALID` | Confirmation token expired, reused, or scope-mismatched |
| `POLICY_BLOCKED_CAPABILITY_INVALID` | Capability token expired, malformed, or scope-mismatched |
| `POLICY_BLOCKED_SIGNING_KEY_UNAVAILABLE` | 1Password unreachable or key missing |
| `POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE` | Broker unreachable; resource server fails closed |
| `GIT_DIRTY_INDEX` | Commit attempted with no staged changes and no `paths` (raised at resource server) |
| `GIT_REMOTE_REJECTED` | Underlying push returned non-zero. Embedded output MUST be redacted per the contract above; when in doubt the resource server omits raw output and returns only the exit code. |

### Authentication
```
X-ChittyOS-API-Key: {api_key}
```
Or:
```
Authorization: Bearer {token}
```

## ContextConsciousness™

Cross-service awareness system providing:
- Real-time knowledge of all service states
- Contextual analysis (legal, financial, relational)
- Intelligent routing to optimal services
- State persistence via MemoryCloude™

### ChittyContext (Edge Cache Capability)

ChittyContext is a local edge cache at `~/.claude/chittycontext/` that provides
offline-resilient session state for Claude Code sessions. It is a **capability of
ChittyConnect**, not a standalone service.

**Responsibilities:**
- Auto-resolve session context via MCP bridge on session start
- Cache last-known state locally for offline resilience
- Queue session metrics for async commit to ChittyConnect backend
- Maintain project-scoped state files per entity

**Not a standalone service:** ChittyContext has no charter, no deployment, no health
endpoint. It is a client-side cache governed by ChittyConnect's ContextConsciousness™.

## Ownership

| Role | Owner |
|------|-------|
| Service Owner | ChittyOS |
| Technical Lead | @chittyos-infrastructure |
| Security Contact | security@chitty.cc |

## Three Aspects (TY VY RY)

Source: `chittycanon://gov/governance#three-aspects`

| Aspect | Abbrev | Question | ChittyConnect Answer |
|--------|--------|----------|--------------------|
| **Identity** | TY | What IS it? | AI-intelligent spine — the universal connector enabling GPTs, Claude, and third-party integrations to interact with the ChittyOS ecosystem |
| **Connectivity** | VY | How does it ACT? | Three interfaces: REST API (Custom GPT Actions), MCP Server (Claude), GitHub App (webhooks); proxies Notion, OpenAI, Neon, Google Calendar; ContextConsciousness™ cross-session state |
| **Authority** | RY | Where does it SIT? | Tier 2 Platform — integration hub, not source of truth; delegates identity to ChittyID, auth to ChittyAuth, registration to ChittyRegister |

## Document Triad

This charter is part of a synchronized documentation triad. Changes to shared fields must propagate.

| Field | Canonical Source | Also In |
|-------|-----------------|---------|
| Canonical URI | CHARTER.md (Classification) | CHITTY.md (blockquote) |
| Tier | CHARTER.md (Classification) | CHITTY.md (blockquote) |
| Domain | CHARTER.md (Classification) | CHITTY.md (blockquote), CLAUDE.md (header) |
| Endpoints | CHARTER.md (API Contract) | CHITTY.md (Endpoints table), CLAUDE.md (API section) |
| Dependencies | CHARTER.md (Dependencies) | CHITTY.md (Dependencies table), CLAUDE.md (Architecture) |
| Certification badge | CHITTY.md (Certification) | CHARTER.md frontmatter `status` |

**Related docs**: [CHITTY.md](CHITTY.md) (badge/one-pager) | [CLAUDE.md](CLAUDE.md) (developer guide)

## Compliance

- [x] Service registered in ChittyRegistry
- [x] Health endpoint operational at /health
- [x] OpenAPI specification published
- [x] CLAUDE.md development guide present
- [x] MCP manifest published
- [x] GitHub App webhook verified

---
*Charter Version: 1.0.0 | Last Updated: 2026-02-23*
