---
uri: chittycanon://docs/tech/architecture/chittycontext-enhancement
namespace: chittycanon://docs/tech
type: architecture
version: 1.0.0
status: DRAFT
registered_with: chittycanon://core/services/canon
title: "ChittyContext Enhancement Design"
author: "ChittyOS Foundation"
certifier: chittycanon://gov/authority/chittygov
created: 2026-02-23T00:00:00Z
visibility: INTERNAL
references:
  - chittycanon://docs/tech/architecture/context-anchor-model
  - chittycanon://docs/tech/architecture/experience-provenance-schema
  - chittycanon://gov/governance#core-types
  - chittycanon://docs/tech/spec/chittyid-format
  - chittycanon://core/services/chittyconnect
  - chittycanon://core/services/chittyid
---

# ChittyContext Enhancement Design

## Problem Statement

ChittyContext is a local filesystem skill (`~/.claude/chittycontext/`) that provides
rudimentary JSON-on-disk state persistence. Meanwhile, ChittyConnect has a fully
implemented intelligence layer (8,854 LOC) with ContextConsciousness, MemoryCloude,
Context Resolver, Experience Anchor, and Context Intelligence — all backed by D1
database tables (context_entities, context_dna, context_ledger, session_bindings,
trust_log, lifecycle_events, behavioral_events). The two systems are not connected.

Session continuity is the #1 friction point: 5+ sessions burned just finding where
prior work left off. The existing system requires manual `/chittycontext checkpoint`
invocations. Context does not automatically persist, restore, or evolve.

## Design Goals

1. **Auto-save/restore** — No manual checkpointing. Hooks handle lifecycle.
2. **Multi-project awareness** — Detect project from cwd, load correct context.
3. **Richer state model** — Track git state, decisions, entities, experience metrics.
4. **ChittyConnect integration** — Sync to backend as source of truth.
5. **Synthetic entity model** — Context is a Person (P, Synthetic) that accumulates
   experience, has ChittyDNA, ChittyLedger entries, and evolving trust.

## Architecture

### Three Layers

```
LAYER A: LOCAL HOOKS + CACHE
  SessionStart → detect project → load cached state
  During session → accumulate experience locally
  Stop → save state → sync to backend

LAYER B: CHITTYCONNECT BACKEND (source of truth)
  Context Resolver → ChittyID binding
  MemoryCloude → 90-day semantic memory
  ContextConsciousness → behavioral tracking
  Experience Anchor → provenance chains
  Context Intelligence → trust evolution
  D1 tables: context_entities, context_dna, context_ledger,
             session_bindings, trust_log, lifecycle_events

LAYER C: MCP BRIDGE
  chittymcp (mcp.chitty.cc) tools:
    context_resolve  → bind session to ChittyID
    context_restore  → load experience profile + last state
    context_commit   → commit session experience
    context_check    → get current trust/DNA summary
    memory_persist   → store semantic memory
    memory_recall    → cross-session recall
```

### Data Flow

```
Session Start:
  1. Hook reads cwd → derives project slug
  2. Check local cache (~/.claude/chittycontext/entities/{id}/{project}/)
  3. Call MCP context_resolve with project_path + platform
     → Returns: ChittyID, experience_profile, context_dna, last_state
  4. If MCP unavailable: use local cache (offline mode)
  5. Write session_binding.json with resolved ChittyID + session metadata

During Session:
  6. Local accumulator tracks: interactions, decisions, entities discovered
  7. On significant events (task complete, file commit, analysis conclusion):
     → Call MCP memory_persist with semantic summary
  8. Local current_state.json updated incrementally

Session End:
  9. Hook calls MCP context_commit with session metrics:
     → interactions_count, decisions_count, entities_discovered
     → session_success_rate, session_risk_score
  10. Backend updates: experience_profiles, trust recalculation, DNA sync
  11. Backend appends: context_ledger entry (chained hash)
  12. Local cache updated with latest state for offline resilience
```

### Offline Resilience

When MCP is unavailable (no network, service down):
- Local cache serves as read source (step 4 fallback)
- Session metrics queued in `~/.claude/chittycontext/sync_queue.json`
- Next session start attempts to drain the queue before resolving
- No local ChittyID generation — use cached ID from last successful resolve
- If no cached ID exists at all: session runs without identity binding,
  metrics are queued with a placeholder session_id for later reconciliation

This respects the ChittyID Charter mandate: **STRICT NO LOCAL GENERATION**.

## Local State Schema (v2.0)

### session_binding.json

```json
{
  "chittyId": "03-1-USA-XXXX-P-2602-0-XX",
  "sessionId": "session-{timestamp}-{random}",
  "platform": "claude_code",
  "projectPath": "/Users/nb/Desktop/Projects/github.com/CHITTYOS/chittyconnect",
  "projectSlug": "chittyconnect",
  "organization": "CHITTYOS",
  "supportType": "development",
  "resolvedFrom": "mcp",
  "resolvedAt": "2026-02-23T18:15:10Z",
  "trustLevel": 3,
  "trustScore": 50.00,
  "status": "active"
}
```

### current_state.json (per-project)

```json
{
  "version": "2.0",
  "chittyId": "03-1-USA-XXXX-P-2602-0-XX",
  "project": {
    "slug": "chittyconnect",
    "name": "ChittyConnect",
    "path": "/Users/nb/Desktop/Projects/github.com/CHITTYOS/chittyconnect"
  },
  "session": {
    "id": "session-{timestamp}-{random}",
    "startedAt": "ISO8601",
    "lastActivity": "ISO8601",
    "metrics": {
      "interactions": 0,
      "decisions": 0,
      "entitiesDiscovered": 0,
      "toolCalls": 0,
      "filesModified": []
    }
  },
  "context": {
    "summary": "One-paragraph description of current work state",
    "activeGoals": [],
    "completedGoals": [],
    "blockers": []
  },
  "git": {
    "branch": "main",
    "lastCommit": "abc1234",
    "uncommittedFiles": []
  },
  "decisions": [
    {
      "timestamp": "ISO8601",
      "description": "What was decided",
      "reasoning": "Why",
      "alternatives": ["What was rejected"]
    }
  ],
  "nextActions": [],
  "syncedToBackend": true,
  "lastSyncAt": "ISO8601"
}
```

### experience_accumulator.json (per-entity, rolling)

```json
{
  "chittyId": "03-1-USA-XXXX-P-2602-0-XX",
  "totalSessions": 85,
  "totalInteractions": 1312,
  "totalDecisions": 94,
  "successRate": 0.83,
  "expertiseDomains": [
    { "domain": "cloudflare-workers", "level": "proficient", "sessions": 45 },
    { "domain": "legal-evidence", "level": "competent", "sessions": 12 },
    { "domain": "infrastructure", "level": "proficient", "sessions": 20 }
  ],
  "lastUpdated": "ISO8601",
  "syncedFromBackend": true
}
```

### sync_queue.json (offline buffer)

```json
{
  "pending": [
    {
      "type": "context_commit",
      "timestamp": "ISO8601",
      "sessionId": "...",
      "payload": { "interactions": 15, "decisions": 2 }
    }
  ]
}
```

## Hook Implementations

### SessionStart Hook

```bash
#!/usr/bin/env bash
# chittycontext-session-start.sh
# Registered as SessionStart hook in settings.json

CONTEXT_DIR="$HOME/.claude/chittycontext"
PROJECT_PATH="$(pwd)"
PROJECT_SLUG=$(basename "$PROJECT_PATH")
ORG=$(basename "$(dirname "$PROJECT_PATH")")

# 1. Drain sync queue if pending items exist
if [ -f "$CONTEXT_DIR/sync_queue.json" ]; then
  PENDING=$(python3 -c "import json; q=json.load(open('$CONTEXT_DIR/sync_queue.json')); print(len(q.get('pending',[])))" 2>/dev/null)
  if [ "$PENDING" -gt 0 ]; then
    echo "[ChittyContext] Draining $PENDING queued sync items..."
    # MCP drain call via can chitty context-drain
  fi
fi

# 2. Resolve context via MCP (or fall back to local cache)
# The MCP call returns ChittyID, experience profile, DNA, last state
# Implementation: can chitty context-resolve --project="$PROJECT_SLUG" --org="$ORG"

# 3. Load local state as fallback
ENTITY_DIR="$CONTEXT_DIR/entities"
if [ -d "$ENTITY_DIR" ]; then
  # Find entity dir matching this project
  STATE_FILE=$(find "$ENTITY_DIR" -path "*/$PROJECT_SLUG/current_state.json" 2>/dev/null | head -1)
  if [ -n "$STATE_FILE" ]; then
    echo "[ChittyContext] Loaded state for $PROJECT_SLUG"
  fi
fi

# 4. Write session binding
cat > "$CONTEXT_DIR/session_binding.json" << BINDING
{
  "projectPath": "$PROJECT_PATH",
  "projectSlug": "$PROJECT_SLUG",
  "organization": "$ORG",
  "platform": "claude_code",
  "boundAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "active"
}
BINDING
```

### Stop Hook

```bash
#!/usr/bin/env bash
# chittycontext-session-end.sh
# Registered as Stop hook in settings.json

CONTEXT_DIR="$HOME/.claude/chittycontext"

# 1. Read current session binding
if [ ! -f "$CONTEXT_DIR/session_binding.json" ]; then
  exit 0
fi

PROJECT_SLUG=$(python3 -c "import json; print(json.load(open('$CONTEXT_DIR/session_binding.json')).get('projectSlug',''))" 2>/dev/null)

# 2. Attempt MCP context_commit
# can chitty context-commit --project="$PROJECT_SLUG"
# If MCP fails, queue the commit locally

# 3. Update session binding status
python3 -c "
import json
with open('$CONTEXT_DIR/session_binding.json', 'r+') as f:
    b = json.load(f)
    b['status'] = 'ended'
    b['endedAt'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
    f.seek(0)
    json.dump(b, f, indent=2)
    f.truncate()
" 2>/dev/null
```

## MCP Tool Enhancements

### New Tools (add to ChittyConnect MCP tool-dispatcher.js)

| Tool | Purpose | Parameters |
|------|---------|------------|
| `context_resolve` | Resolve/bind session to ChittyID | `project_path`, `platform`, `support_type` |
| `context_restore` | Load full context state for a project | `chitty_id`, `project_slug` |
| `context_commit` | Commit session experience metrics | `session_id`, `metrics`, `decisions[]` |
| `context_check` | Get current trust/DNA/experience summary | `chitty_id` |
| `context_checkpoint` | Create named checkpoint | `chitty_id`, `project_slug`, `name`, `state` |

### Enhanced Existing Tools

| Tool | Enhancement |
|------|-------------|
| `memory_persist` | Add `chitty_id` parameter for identity-bound storage |
| `memory_recall` | Add `chitty_id` parameter for cross-session recall |

## Cardinal Remediation (Incorporated)

The following Cardinal audit findings are addressed in this design:

### Critical: Entity Type Heresy

**Root cause**: Minting code uses "T" (Thing), "CONTEXT", "context_identity",
and non-canonical lifecycle codes (S/F/D/X) in the entity type position.

**Fix**: All context entities mint as type **"P"** (Person, Synthetic).
Lifecycle provenance (supernova, fission, derivative, suspension) moves to
the `issuer` metadata field in context_entities, not the ChittyID type position.

Files requiring changes:
- `src/intelligence/context-resolver.js:262` — `entity_type: 'CONTEXT'` → `'P'`
- `src/intelligence/context-resolver.js:285` — `const type = 'T'` → `'P'`
- `src/intelligence/context-intelligence.js:27` — Remove S/F/D/X from entityType param
- `src/intelligence/experience-anchor.js:198` — `entity_type: "context_identity"` → `'P'`
- `src/intelligence/experience-anchor.js:227-229` — Replace timestamp+random with
  canonical format fallback (still must call id.chitty.cc when available)

### Critical: Existing ChittyID Re-mint

The existing IDs `03-1-USA-7165-T-2602-0-13` and `03-1-USA-2709-T-2602-0-42`
carry "T" in the type position. They must be re-minted via `id.chitty.cc` with
type "P". The old IDs are recorded in a `supersedes` field.

Local migration:
1. Call `id.chitty.cc/api/v2/chittyid/mint` with `entity_type: "P"`,
   `characterization: "Synthetic"`, `metadata: { supersedes: "03-1-USA-7165-T-..." }`
2. Rename entity directories: `entities/03-1-USA-7165-T-...` → `entities/{new-P-id}`
3. Update manifest.json, identity.json, all session_binding references
4. Record migration in manifest.json `migrationLog`

### Major: ChittyDNA Preferences Column

Remove `preferences` from context_dna table and all queries that read/write it.
Preferences belong in session_binding metadata or a separate context_preferences
table. The genetic vault contains only: patterns, traits, competencies,
expertise_domains, metrics.

Files: `context-resolver.js:236`, `context-intelligence.js:125,139`

### Major: Architecture Doc Frontmatter

CONTEXT_ANCHOR_MODEL.md and EXPERIENCE_PROVENANCE_SCHEMA.md need canonical
YAML frontmatter (see this document's frontmatter as template).

### Major: Canonical URI Annotations

Add `@canonical-uri` JSDoc to experience-anchor.js and memory-cloude.js.

## Charter Gaps Addressed

### ChittyContext Charter

ChittyContext is a **capability of ChittyConnect**, not a standalone service.
It should be documented as a capability section in the ChittyConnect Charter,
not given its own charter. The local component (`~/.claude/chittycontext/`)
is an edge cache, not a service.

### Charter Frontmatter Upgrades Needed

| Charter | Current | Needs |
|---------|---------|-------|
| ChittyID | No frontmatter | Add canonical frontmatter (Tier 1, Foundation) |
| ChittyConnect | No frontmatter | Add canonical frontmatter (Tier 2, Platform) |
| ChittyRouter | No frontmatter | Add canonical frontmatter (Tier 2, Core Infra) |
| ChittyEvidence | No frontmatter | Add canonical frontmatter (Tier 4, Domain) |
| ChittyContextual | No frontmatter | Add canonical frontmatter (Tier 4, Application) |
| chittymac | Empty file | Write charter from scratch |

## Skill Enhancement

The existing `/chittycontext` skill at `~/.claude/skills/chittycontext/SKILL.md`
is rewritten to:

1. Remove Desktop Commander references (not available in Claude Code)
2. Auto-trigger on session start (read state) and session end (save state)
3. Add MCP-backed commands: `resolve`, `commit`, `drain`, `check`
4. Keep offline-capable commands: `checkpoint`, `restore`, `status`
5. Add `experience` command to display ChittyDNA summary and trust score

## ChittyDNA Integration

On session commit, the backend:
1. Updates `context_dna` with session metrics (weighted average for success_rate,
   set-union for competencies)
2. Syncs DNA profile to R2 `chittycan-dna-vaults` bucket
3. The DNA profile contains: expertise domains with skill levels, experience
   metrics (total interactions, success rate, verification rate), accountability
   metrics (total actions, harm incidents, remediation rate)
4. DNA is the genetic vault — what the entity has BECOME through accumulated
   experience, not configuration preferences

## ChittyLedger Integration

Every session commit appends a ledger entry to `context_ledger`:
```json
{
  "entry_type": "session_complete",
  "chitty_id": "03-1-USA-XXXX-P-2602-0-XX",
  "session_id": "session-...",
  "project_slug": "chittyconnect",
  "metrics": { "interactions": 15, "decisions": 2 },
  "previous_hash": "abc123...",
  "content_hash": "def456...",
  "timestamp": "ISO8601"
}
```

The hash chain ensures tamper-evident history. Each entry's `content_hash`
is derived from the entry content + `previous_hash`, creating an append-only
verifiable log.

## Cross-Platform Identity (ChittySeed alignment)

Per the ChittySeed Charter, agents across platforms derive from the same seed.
ChittyContext uses the same ChittyID across:

| Platform | Resolution Method |
|----------|-------------------|
| Claude Code | SessionStart hook → MCP context_resolve |
| Claude Desktop | MCP server config → context_resolve on init |
| CustomGPT | REST API → `/api/v1/experience/resolve` |
| GitHub Copilot | ChittySeed platform.md → agent.chitty.cc |

The ChittyID is the **immutable anchor**. Platform is metadata in the
session binding, not part of the identity.

## Implementation Phases

### Phase 1: Cardinal Remediation (Backend fixes)
- Fix entity type minting in context-resolver.js, context-intelligence.js,
  experience-anchor.js (all → type "P")
- Remove preferences from context_dna queries
- Add canonical URI annotations to experience-anchor.js, memory-cloude.js
- Add frontmatter to CONTEXT_ANCHOR_MODEL.md, EXPERIENCE_PROVENANCE_SCHEMA.md

### Phase 2: MCP Tool Registration
- Add context_resolve, context_restore, context_commit, context_check,
  context_checkpoint to tool-dispatcher.js
- Enhance memory_persist and memory_recall with chitty_id parameter
- Deploy to staging, verify via MCP debug

### Phase 3: Local Hooks + Cache
- Create chittycontext-session-start.sh hook
- Create chittycontext-session-end.sh hook
- Register in ~/.claude/settings.json
- Implement sync_queue.json for offline buffering
- Upgrade local state schema to v2.0

### Phase 4: ChittyID Re-mint + Migration
- Re-mint existing T-typed IDs as P-typed via id.chitty.cc
- Migrate local entity directories
- Update all references atomically
- Record migration in manifest.json

### Phase 5: Charter + Doc Governance
- Add canonical frontmatter to 5 charters (ChittyID, ChittyConnect,
  ChittyRouter, ChittyEvidence, ChittyContextual)
- Write chittymac CHARTER.md
- Add ChittyContext capability section to ChittyConnect Charter
- Register this design doc with chittycanon://core/services/canon

### Phase 6: Full Activation
- Enable trust evolution recalculation on session commit
- Enable ChittyDNA sync to R2 vaults
- Enable cross-platform context sharing via ChittySeed
- Activate ContextConsciousness behavioral monitoring

## Success Criteria

1. Session start auto-loads the correct project context (no manual restore)
2. Session end auto-persists state and experience metrics (no manual checkpoint)
3. Context survives across sessions without context window compaction loss
4. ChittyDNA reflects accumulated expertise across all sessions
5. Trust score evolves based on demonstrated competency
6. All entity types minted as "P" (Person, Synthetic) — zero "T" type contexts
7. Works offline with graceful degradation (local cache + sync queue)
