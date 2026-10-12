# mcp.chitty.cc Model B (CF MCP Portal) Migration — D1–D10 Board

**Status as of 2026-06-12:** prep phase (D1–D3 + verify-items) executed; **D5 (first live-portal mutation) is NO-GO** pending two blockers (see bottom).

**Locked decisions (2026-06-10, operator nick@chittycorp.com):**
- CQRS triad — **ChittyRegister = WRITE** (`register.chitty.cc/api/v1/register`, gatekeeper) · **ChittyRegistry = DISCOVERY** (`registry.chitty.cc/v0.1/servers`, read mirror) · **CF MCP Portal = client PROJECTION** (written only by the projection Workflow, off discovery).
- Trigger = beacon double-posts (beacon writes register THEN enqueues the Workflow); NO ChittyRegister outbound-webhook; daily reconcile sweep as backstop.
- Combo-prompts hosted on the chittyagent-alchemist server.
- Live portal API = `/accounts/{acct}/access/ai-controls/mcp/{portals,servers}` (+ `servers/{id}/sync`). Old `/access/mcp/*` is dead (401).
- Canonical projection target = **`chitty-mcp`** portal (hostname `mcp.chitty.cc`).

## 2026-10-12 Cloudflare reconciliation — source-only, NO-GO maintained

Authenticated read-only Cloudflare evidence (ChittyCorp account):
- `chitty-mcp` at `mcp.chitty.cc` currently has **16** members (the historical 27-member June snapshot below is preserved for provenance, not today's baseline).
- The current ai-controls `PUT /portals/{id}` schema permits **80** members, **not 40**. The portal-specific schema explicitly includes `server_id`, `default_disabled`, `on_behalf`, `updated_tools`, and `updated_prompts`; the portal update may also carry `code_mode`, `secure_web_gateway`, `description`. Losing these during a whole-array PUT is a privilege/configuration regression.
- ChittyConnect production **has no** `MCP_PORTAL_PROJECTION`, `MCP_PORTAL_ID`, `MCP_PORTAL_PROJECTION_ENABLED`, or `CF_API_TOKEN` bindings; there is no live Workflow activation. A Cloudflare Workflow resource named `mcp-portal-projection` exists but has zero retained instances; the GitHub implementation remains **PR #248 (unmerged)**.
- This PR has been hardened to **add-only, disabled-by-default** for new members. The legacy payload removal override is rejected. Existing member OAuth/tool/prompt overrides are preserved; no implicit removals are authorized. Flag is still default-OFF. The current 16-member portal is not modified by these source changes.
- **D5 remains NO-GO.** First reconcile authenticated registry identity and account-level server mapping, prove no collateral deletions or policy rewrites with the current 16-member read-back, and obtain explicit deployment and credential-scope approval. No new token or parallel portal owner.

The older D1–D10 board and dated measurements below are historical context.

## Board

| # | Task | State | Evidence / Notes |
|---|------|-------|------------------|
| D1 | Rewrite `CfPortalClient` (chittyagent-mcp-builder) → live ai-controls surface + two-level model | **DONE (PR)** | chittyos/chittyentity#489. tsc clean, 19/19 tests. Lib-only, no deploy. |
| D2 | Scaffold `MCPPortalProjection` Workflow + `POST /api/v1/mcp-portal/build-event`, flag DEFAULT-OFF | **DONE (PR)** | chittyos/chittyconnect#248. Inertness proven via `--dry-run` binding summary; `MCP_PORTAL_PROJECTION_ENABLED="false"`. |
| D3 | Dry-run read-only diff (registry vs live `chitty-mcp` 27 servers) | **DONE** | `scripts/mcp-portal-dryrun.mjs`. Result: discovery yields only **4** compliant; diff = add 4 / **remove ALL 27** / keep 0. **Blocker.** |
| D4 | Confirm write verb on a scratch portal | **DONE** | Scratch portal+server round-trip: `POST /portals` & `POST /servers` (require `id`), portal membership = **whole-array `PUT /portals/{id}`** (servers[] returned `["scratch-probe-srv"]`), then DELETEd. Live portals untouched. CAVEAT: PUT with empty `servers:[]` returned 400 — see Open risk. |
| D5 | Enable projection for ONE server (first live mutation) | **NO-GO (BLOCKED)** | Gated on (a) discovery source reconcile, (b) `CF_API_TOKEN` provisioning on ChittyConnect. See blockers. |
| D6 | Repoint post-deploy beacon to dual-write (register + enqueue Workflow) | TODO | Depends on D5. |
| D7 | Wire CF Notification → webhook + build watch paths | TODO | Depends on D6. |
| D8 | Daily reconcile sweep cron | TODO | Idempotent re-project; same PUT path. |
| D9 | Cut autobot → register; 410 the retired `/admin/bind` | TODO | |
| D10 | Ship alchemist combo-prompt synthesizer | TODO | Combo-prompts on chittyagent-alchemist server. |

## Verify-item answers (read-only / scratch)

1. **Portal write verb + shape** — Two-level. (a) Account-level server: `POST /accounts/{acct}/access/ai-controls/mcp/servers` per-server, body requires `{id, name, hostname, auth_type}` (`id` pattern `^[a-z0-9_]+(?:-[a-z0-9_]+)*$`, maxLen 32). (b) Portal membership: **whole-array** `PUT /accounts/{acct}/access/ai-controls/mcp/portals/{id}` with `servers:[{server_id, default_disabled?, on_behalf?, updated_tools?, updated_prompts?}]` (`server_id` required). There is NO `/portals/{id}/servers` sub-resource. Confirmed empirically via scratch round-trip + the CF OpenAPI spec.
2. **Real per-portal server cap (historical 2026-06-12)** — originally documented as **40**. **Updated 2026-10-12:** live Cloudflare OpenAPI `PUT /portals/{id}` schema permits **80** (`servers[].maxItems: 80`); today's portal holds **16**, and current unused cap is 64. Do not use the June snapshot for admission.
3. **Canonical portal** — **`chitty-mcp`** (hostname `mcp.chitty.cc`). Evidence: CF Access app `80992774-49c7-4419-9866-4a92ab5fac19` is type `mcp_portal`, name `ChittyMCP`, domain `mcp.chitty.cc` — the auto-created Access app for the `chitty-mcp` portal (created 2026-06-10 12:51, matching the operator's connector-wiring window). The duplicate `chitty-os-mcp-portal` (`mcp-portal.chitty.cc`, created 2026-03-24) is the older non-wired mirror.

## BLOCKERS to D5 (first live mutation)

1. **The projection's desired-set is undefined — DESIGN gap, not just data backfill.** A literal projection today = **add 4 / remove all 27 / keep 0** (empty-set brake does NOT catch it; desired=4, not 0). Three sub-problems, all must be resolved before any write:
   - **(1a) Registry is sparse.** `/v0.1/servers` has 16 entries, only 8 with URLs; the canonical filter (`https://{svc}.chitty.cc/mcp`) yields 4. Backfill it to mirror the portal's READY endpoints — e.g. `resolve.chitty.cc/mcp`, `tasks.chitty.cc/mcp` (live, `status:"ready"`, tools synced). **The canonical `{svc}.chitty.cc/mcp` form is correct** — the live portal proves it works. An earlier memory note claiming this form 404s and that `{svc}.agent.chitty.cc/mcp` is the live form is **STALE** (it referred to the constructed strings in `/v0.1/servers`, not the deployed services).
   - **(1b) Endpoint-pattern coverage.** The 27 members span THREE patterns: `{svc}.chitty.cc/mcp`, `*.ccorp.workers.dev/mcp` (~12 direct-route: orchestrator, evidence, storage, scrape, twilio, dispute, notes, gam, bluebubbles, chatgpt, auth, ship), and third-party (`developers.openai.com/mcp`, `mcp.cloudflare.com/mcp`). A canonical-only filter would remove all direct-route + third-party members **even against a complete registry**. The model needs an explicit decision on how direct-route and third-party servers are represented in (or excluded from) projection scope.
   - **(1c) ID mapping.** `portalIdFromUrl("ship.chitty.cc/mcp")` → `ship`, but the portal server id is `chittyagent-ship`. Desired-set IDs must be mapped to portal server IDs or every run churns spurious add/removes.
2. **`CF_API_TOKEN` not provisioned on ChittyConnect (re-verified 2026-10-12).** The Workflow's write path requires narrowly scoped, runtime-brokered Cloudflare ai-controls authorization from ChittyConnect/ChittySecrets; **1Password is retired**, so do not restore its credentials or copy a permanent token into Worker variables. Not yet bound on the worker. Route via ch1tty → ChittyConnect (no plaintext). (The ai-controls scope itself is proven working — the scratch round-trip succeeded — so this is a provisioning, not a capability, gap.)

## Open risk (non-blocking, unproven)

- **PUT-with-empty-`servers:[]` is unconfirmed (HTTP 400 observed).** The scratch round-trip proved PUT-add (membership returned `["scratch-probe-srv"]`), but a follow-up PUT with `servers:[]` returned **400**. `setPortalServers`/`removeServer` use a whole-array PUT, so removing the LAST member may 400. Must be confirmed and handled (portal-delete vs min-1 invariant) before the projection remove path can empty a portal. Flag-off D2 code, so non-blocking this run.

## Backfill pass (2026-06-12) — guard shipped, seed BLOCKED by plumbing gap

**Done (PR #248, commit `e2f54c8`, flag still default-OFF / inert):**
- **Removal-safety guard (June behavior; superseded 2026-10-12):** the pure function still reports suspicious sparse discovery. The Workflow no longer authorizes any server removal or accepts `payload.overrideRemovalGuard`; add-only membership writes preserve existing per-server flags/overrides and default-disable new members. Initial add capability remains feature-flagged OFF and D5 blocked.
- **Hostname-keyed diff** — resolves blockers **1b + 1c**: `computePortalDiff` keys on normalized hostname (not URL-slug id), so `chittyagent-ship` vs `ship` never churns (1c); `fetchDiscoveryServers` widened past canonical filter to include `*.ccorp.workers.dev/mcp` + third-party (1b). 13 real tests, 455/455 suite green.
- **Live audit of all 27 portal servers** (POST init probe): **25 READY (200)**, **2 READY-AUTH (401: chittyagent-market, cloudeflare-codemode)**, **0 GATED-302, 0 DEAD, 0 stale**. Every member is a live, valid MCP endpoint. No reconcile/drop needed.
- **New live dry-run**: discovery yields **5** desired vs portal **27** → literal projection = remove-all-27; **the new guard BLOCKS it** (old `desired===0` brake did NOT — desired was 5).

**NEW HARD BLOCKER (supersedes old blocker 1a as stated): the reverse-seed path does not exist.**
The locked model says "ChittyRegister = WRITE, propagates to registry/discovery." **Empirically false for the MCP-server surface:**
- `register.chitty.cc/openapi.json` exposes only service-registration paths (`/api/v1/register` requires `endpoints`+`schema.entities`+`/health`); **no MCP-server registration path**. Register writes its own Neon `service_registrations` table.
- `registry.chitty.cc/v0.1/servers` is served from a **hardcoded seed + `mcp-servers:` KV** (`getAllMcpServers`). The **only writer** of that KV is registry's own **`POST /v0.1/servers`** (admin-token `MCP_REGISTRY_ADMIN_TOKEN`, OR a chittyregister service-binding carrying `X-Chitty-Internal-Binding: chittyregister`).
- ChittyRegister has a `REGISTRY` service binding declared in wrangler but **`env.REGISTRY` is referenced nowhere in code**, and register has **no `/v0.1/servers` call**. The register→MCP-discovery bridge is **unimplemented**.

⇒ Writing `register.chitty.cc/api/v1/register` will NOT populate discovery, so it cannot produce the no-op dry-run. Seeding was therefore **NOT performed** (it would 400 on schema or pollute the services catalog — a harmful no-value write). The surface that *would* feed discovery is **registry's admin `POST /v0.1/servers`** — outside this run's approved boundary (which named ChittyRegister only). **Operator decision required:** either (a) authorize seeding via registry's admin POST surface, or (b) implement the register→`mcp-servers:` KV propagation bridge so the locked CQRS model becomes real. Until then discovery stays sparse — but **the portal is now safe regardless**, because the guard blocks the wipe.

## Where this board lives

Primary durable copy: this file (tracked in chittyos/chittyconnect, travels with PR #248). ChittyTasks (chittyagent-tasks) does not expose a create-task tool over the available connector surface this run; Notion mirror attempted as secondary.
