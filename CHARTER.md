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

#### Planned (Spec)
> The following tools are spec-only — not yet present in the `MCP_TOOLS` registry.
> Implementation tracked in chittyos/chittyconnect#209. See "Git Tool Surface" below
> for full schemas and policy gates.

- `[SPEC] git_commit` - Create signed commit in an allowlisted repo (policy-gated)
- `[SPEC] git_push` - Push to an allowlisted remote (policy-gated, force operations require second-factor)
- `[SPEC] git_tag` - Create signed tag at a ref (policy-gated)

### Git Tool Surface (write/sensitive) — SPEC

> **Status: SPEC** — these tools are NOT YET IMPLEMENTED. They are not present in
> the `MCP_TOOLS` registry. Implementation tracked in chittyos/chittyconnect#209.
>
> Read-only git tools (`git_status`, `git_log`, `git_diff`, `git_show`, `git_blame`,
> `git_branch_list`) live on chittymcp via the `chittyagent-git` upstream. Write
> tools are spec'd here on ChittyConnect because they fall under the sensitive-intent
> contract (`~/.ch1tty/canon/system-wide-sensitive-intent-contract-v1.md`) and
> require OAuth + 1Password-zerotrust + ChittyLedger audit.
>
> **Signing is mandatory and non-overridable** for `git_commit` and `git_tag` —
> the input schema deliberately omits a `sign` field so clients cannot disable it.
> The implementation MUST sign every commit and tag.

#### `[SPEC] git_commit`

```json
{
  "name": "git_commit",
  "description": "Create a signed commit in an allowlisted local repo. Signing is mandatory and non-overridable. Signing key resolved from 1Password; never from env or disk plaintext.",
  "input_schema": {
    "type": "object",
    "required": ["repo_path", "message"],
    "additionalProperties": false,
    "properties": {
      "repo_path":  { "type": "string", "description": "Absolute path; must match CHITTYCONNECT_GIT_REPO_ROOTS allowlist." },
      "message":    { "type": "string", "minLength": 1, "maxLength": 4096 },
      "paths":      { "type": "array",  "items": { "type": "string" }, "description": "Optional explicit paths; defaults to all staged." },
      "author":     { "type": "string", "description": "Optional 'Name <email>' override; subject to author allowlist." }
    }
  },
  "output_schema": {
    "type": "object",
    "required": ["commit_sha", "signed", "ledger_event_id"],
    "properties": {
      "commit_sha":      { "type": "string" },
      "signed":          { "type": "boolean", "const": true, "description": "Always true — signing is mandatory." },
      "signing_key_op":  { "type": "string", "description": "1Password op:// reference used (not the key)." },
      "ledger_event_id": { "type": "string" }
    }
  }
}
```

#### `[SPEC] git_push`

```json
{
  "name": "git_push",
  "description": "Push a ref to an allowlisted remote. Force operations require explicit second-factor confirmation. force and force_with_lease are mutually exclusive; either one requires a confirmation_token. Force-push to main/master is hard-denied.",
  "input_schema": {
    "type": "object",
    "required": ["repo_path", "ref"],
    "additionalProperties": false,
    "properties": {
      "repo_path":         { "type": "string" },
      "remote":            { "type": "string", "default": "origin" },
      "ref":               { "type": "string", "description": "Local ref or refspec." },
      "force":             { "type": "boolean", "default": false },
      "force_with_lease":  { "type": "boolean", "default": false },
      "confirmation_token":{ "type": "string", "description": "Required when force=true OR force_with_lease=true. Short-lived token from ChittyConnect's confirm endpoint." }
    },
    "allOf": [
      {
        "not": {
          "type": "object",
          "properties": {
            "force":            { "const": true },
            "force_with_lease": { "const": true }
          },
          "required": ["force", "force_with_lease"]
        }
      },
      {
        "if": {
          "anyOf": [
            { "type": "object", "properties": { "force":            { "const": true } }, "required": ["force"] },
            { "type": "object", "properties": { "force_with_lease": { "const": true } }, "required": ["force_with_lease"] }
          ]
        },
        "then": { "required": ["confirmation_token"] }
      }
    ]
  },
  "output_schema": {
    "type": "object",
    "required": ["remote_url", "pushed_refs", "ledger_event_id"],
    "properties": {
      "remote_url":      { "type": "string", "description": "REDACTED form of the remote URL — userinfo (any embedded credentials matching https?://[^@]+@) MUST be stripped before return. Example: https://github.com/owner/repo.git (never https://TOKEN@github.com/...)." },
      "pushed_refs":     { "type": "array", "items": { "type": "string" } },
      "ledger_event_id": { "type": "string" }
    }
  }
}
```

#### `[SPEC] git_tag`

```json
{
  "name": "git_tag",
  "description": "Create a signed annotated tag at a ref. Signing is mandatory and non-overridable.",
  "input_schema": {
    "type": "object",
    "required": ["repo_path", "name", "message"],
    "additionalProperties": false,
    "properties": {
      "repo_path": { "type": "string" },
      "name":      { "type": "string", "pattern": "^(?!-)[A-Za-z0-9._/-]+$", "description": "Tag name. MUST NOT start with '-' to prevent option-injection if the implementation shells out to git." },
      "ref":       { "type": "string", "default": "HEAD" },
      "message":   { "type": "string", "minLength": 1 }
    }
  },
  "output_schema": {
    "type": "object",
    "required": ["tag_name", "object_sha", "signed", "ledger_event_id"],
    "properties": {
      "tag_name":        { "type": "string" },
      "object_sha":      { "type": "string" },
      "signed":          { "type": "boolean", "const": true, "description": "Always true — signing is mandatory." },
      "ledger_event_id": { "type": "string" }
    }
  }
}
```

#### Policy gates (binding)

1. **Signing key** — resolved from 1Password via `op://` reference per the sensitive-intent contract. Never read from env vars, disk, or chat. Signing is mandatory for `git_commit` and `git_tag`; the input schemas omit any disable knob. If 1Password is unreachable → fail closed.
2. **Remote allowlist** — per-tenant config. Default allowlist: `github.com/CHITTYOS/*`, `github.com/CHITTYFOUNDATION/*`. Pushes to non-allowlisted remotes → `POLICY_BLOCKED_REMOTE_NOT_ALLOWED`.
3. **Repo allowlist** — `CHITTYCONNECT_GIT_REPO_ROOTS` env (cold-source: 1Password). Repos outside → `POLICY_BLOCKED_REPO_NOT_ALLOWED`.
4. **Force-push guard** — `force=true` OR `force_with_lease=true` requires a fresh `confirmation_token` from `POST /api/git/confirm` (same risk class — both can overwrite remote history). Setting both flags true is rejected at the schema layer. Force-push to `main` or `master` (or repo default branch) is hard-denied regardless of token → `POLICY_BLOCKED_FORCE_TO_PROTECTED`.
5. **Audit** — every successful write emits a ChittyLedger event (domain-tagged `git`, hash-chained per the canonical projection model). The `ledger_event_id` is returned in the response.
6. **Broker liveness** — if the policy broker is unreachable, fail closed with `POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE`. No local fallback.
7. **Credential redaction (binding contract)** — any string returned to the caller that may have originated from a git remote URL or git CLI output MUST pass through a redaction filter before serialization:
   - URL userinfo: the implementation MUST strip the `userinfo` component from any URL, rewriting `https?://[^@]+@` to the scheme-only prefix `https?://`. This applies to the `remote_url` output field and to any URL appearing in error messages.
   - CLI output: the implementation MUST either omit raw `git` stdout/stderr from error envelopes or pass it through the same userinfo-stripping filter plus a token-pattern scrub (common Git provider PAT/OAuth patterns, e.g. `gh[pousr]_[A-Za-z0-9_]{20,}`, `github_pat_[A-Za-z0-9_]{20,}`, `xox[bpars]-[A-Za-z0-9-]{10,}`, generic 40+ char hex/base64 secrets adjacent to `://` or `Authorization:`). When in doubt, omit.

#### Error codes

| Code | Meaning |
|------|---------|
| `POLICY_BLOCKED_REPO_NOT_ALLOWED` | `repo_path` not in allowlist |
| `POLICY_BLOCKED_REMOTE_NOT_ALLOWED` | Remote URL not in tenant allowlist |
| `POLICY_BLOCKED_FORCE_TO_PROTECTED` | Force-push attempted against protected branch |
| `POLICY_BLOCKED_CONFIRMATION_REQUIRED` | `force=true` or `force_with_lease=true` without valid `confirmation_token` |
| `POLICY_BLOCKED_FORCE_FLAGS_CONFLICT` | Both `force` and `force_with_lease` set true (schema-level reject) |
| `POLICY_BLOCKED_SIGNING_KEY_UNAVAILABLE` | 1Password unreachable or key missing |
| `POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE` | Policy broker unreachable; fail closed |
| `GIT_DIRTY_INDEX` | Commit attempted with no staged changes and no `paths` |
| `GIT_REMOTE_REJECTED` | Underlying `git push` returned non-zero. Any embedded output MUST be redacted per the Credential redaction contract above (userinfo stripped, token patterns scrubbed); when in doubt, the implementation omits raw output and returns only the exit code. |

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
