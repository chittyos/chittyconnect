# mcp.chitty.cc Model B (CF MCP Portal) Migration — D1–D10 Board

**Status as of 2026-06-12:** prep phase (D1–D3 + verify-items) executed; **D5 (first live-portal mutation) is NO-GO** pending two blockers (see bottom).

**Locked decisions (2026-06-10, operator nick@chittycorp.com):**
- CQRS triad — **ChittyRegister = WRITE** (`register.chitty.cc/api/v1/register`, gatekeeper) · **ChittyRegistry = DISCOVERY** (`registry.chitty.cc/v0.1/servers`, read mirror) · **CF MCP Portal = client PROJECTION** (written only by the projection Workflow, off discovery).
- Trigger = beacon double-posts (beacon writes register THEN enqueues the Workflow); NO ChittyRegister outbound-webhook; daily reconcile sweep as backstop.
- Combo-prompts hosted on the chittyagent-alchemist server.
- Live portal API = `/accounts/{acct}/access/ai-controls/mcp/{portals,servers}` (+ `servers/{id}/sync`). Old `/access/mcp/*` is dead (401).
- Canonical projection target = **`chitty-mcp`** portal (hostname `mcp.chitty.cc`).

## Board

| # | Task | State | Evidence / Notes |
|---|------|-------|------------------|
| D1 | Rewrite `CfPortalClient` (chittyagent-mcp-builder) → live ai-controls surface + two-level model | **DONE (PR)** | chittyos/chittyentity#489. tsc clean, 19/19 tests. Lib-only, no deploy. |
| D2 | Scaffold `MCPPortalProjection` Workflow + `POST /api/v1/mcp-portal/build-event`, flag DEFAULT-OFF | **DONE (PR)** | chittyos/chittyconnect#248. Inertness proven via `--dry-run` binding summary; `MCP_PORTAL_PROJECTION_ENABLED="false"`. |
| D3 | Dry-run read-only diff (registry vs live `chitty-mcp` 27 servers) | **DONE** | `scripts/mcp-portal-dryrun.mjs`. Result: discovery yields only **4** compliant; diff = add 4 / **remove ALL 27** / keep 0. **Blocker.** |
| D4 | Confirm write verb on a scratch portal | **DONE** | Scratch portal+server round-trip: `POST /portals` & `POST /servers` (require `id`), portal membership = **whole-array `PUT /portals/{id}`** (servers[] returned `["scratch-probe-srv"]`), then DELETEd. Live portals untouched. |
| D5 | Enable projection for ONE server (first live mutation) | **NO-GO (BLOCKED)** | Gated on (a) discovery source reconcile, (b) `CF_API_TOKEN` provisioning on ChittyConnect. See blockers. |
| D6 | Repoint post-deploy beacon to dual-write (register + enqueue Workflow) | TODO | Depends on D5. |
| D7 | Wire CF Notification → webhook + build watch paths | TODO | Depends on D6. |
| D8 | Daily reconcile sweep cron | TODO | Idempotent re-project; same PUT path. |
| D9 | Cut autobot → register; 410 the retired `/admin/bind` | TODO | |
| D10 | Ship alchemist combo-prompt synthesizer | TODO | Combo-prompts on chittyagent-alchemist server. |

## Verify-item answers (read-only / scratch)

1. **Portal write verb + shape** — Two-level. (a) Account-level server: `POST /accounts/{acct}/access/ai-controls/mcp/servers` per-server, body requires `{id, name, hostname, auth_type}` (`id` pattern `^[a-z0-9_]+(?:-[a-z0-9_]+)*$`, maxLen 32). (b) Portal membership: **whole-array** `PUT /accounts/{acct}/access/ai-controls/mcp/portals/{id}` with `servers:[{server_id, default_disabled?, on_behalf?, updated_tools?, updated_prompts?}]` (`server_id` required). There is NO `/portals/{id}/servers` sub-resource. Confirmed empirically via scratch round-trip + the CF OpenAPI spec.
2. **Real per-portal server cap** — **40** (`servers[].maxItems: 40` in the CF OpenAPI spec for both `POST /portals` and `PUT /portals/{id}`). Operator's stated 40 is correct. Portal holds 27 today → headroom 13.
3. **Canonical portal** — **`chitty-mcp`** (hostname `mcp.chitty.cc`). Evidence: CF Access app `80992774-49c7-4419-9866-4a92ab5fac19` is type `mcp_portal`, name `ChittyMCP`, domain `mcp.chitty.cc` — the auto-created Access app for the `chitty-mcp` portal (created 2026-06-10 12:51, matching the operator's connector-wiring window). The duplicate `chitty-os-mcp-portal` (`mcp-portal.chitty.cc`, created 2026-03-24) is the older non-wired mirror.

## BLOCKERS to D5 (first live mutation)

1. **Discovery source is not usable.** `registry.chitty.cc/v0.1/servers` returns 16 sparse entries (only 8 with URLs); applying the spec's canonical filter (`https://{svc}.chitty.cc/mcp`) yields just 4, and their derived IDs (`mcp`, `ship`, `notes`, `connect`) don't match the portal's `chittyagent-*` IDs. A literal projection today = **remove all 27 portal servers**. The empty-set safety brake does NOT catch this (desired=4, not 0). **The registry must be backfilled to mirror the live 27-server set (with stable portal IDs and live `{svc}.agent.chitty.cc/mcp` endpoints) before any projection writes.**
2. **`CF_API_TOKEN` not provisioned on ChittyConnect.** The Workflow's write path needs a `CF_API_TOKEN` with the Zero-Trust **ai-controls** scope, sourced cold from 1Password → Cloudflare Secrets Store. Not yet bound on the worker. Route via ch1tty → ChittyConnect (no plaintext). (The ai-controls scope itself is proven working — the scratch round-trip succeeded — so this is a provisioning, not a capability, gap.)

## Where this board lives

Primary durable copy: this file (tracked in chittyos/chittyconnect, travels with PR #248). ChittyTasks (chittyagent-tasks) does not expose a create-task tool over the available connector surface this run; Notion mirror attempted as secondary.
