---
name: wrangler-audit
description: Audit wrangler.jsonc configuration for consistency, stale compatibility dates, missing tail consumers, binding gaps, and route conflicts. Triggers on "wrangler audit", "audit workers", "check wrangler", "worker consistency", or /wrangler-audit.
user_invocable: true
triggers:
  - /wrangler-audit
  - wrangler audit
  - audit workers
  - check wrangler
  - worker consistency
---

# Wrangler Audit

Audit Cloudflare Worker configurations for this project and optionally across the ChittyOS ecosystem.

## Procedure

### Step 1: Discovery

Find wrangler config in this project:

```bash
ls -la wrangler.toml wrangler.jsonc 2>/dev/null
```

For ecosystem-wide audit, also check:

```bash
find /home/ubuntu/projects/github.com/CHITTYOS -name "wrangler.toml" -o -name "wrangler.jsonc" -not -path "*/node_modules/*" -not -path "*/.wrangler/*" 2>/dev/null
find /home/ubuntu/projects/github.com/CHITTYFOUNDATION -name "wrangler.toml" -o -name "wrangler.jsonc" -not -path "*/node_modules/*" -not -path "*/.wrangler/*" 2>/dev/null
```

### Step 2: Extract Config

For each wrangler config, extract and compare:

| Field | Check |
|-------|-------|
| `name` | Must match `chitty*` naming convention |
| `compatibility_date` | Flag if older than 6 months from today |
| `compatibility_flags` | Note any non-standard flags |
| `main` | Verify entry point file exists |
| `[[tail_consumers]]` | Every worker SHOULD have `service = "chittytrack"` |
| `[vars]` | Check for hardcoded secrets (flag anything that looks like a token/key) |
| `[[kv_namespaces]]` | Cross-reference for duplicate binding names |
| `[[d1_databases]]` | Cross-reference for shared database names |
| `[[r2_buckets]]` | Cross-reference for shared bucket names |
| `[env.production]` / `[env.staging]` | Verify production and staging environments exist |
| `routes` / `*.chitty.cc` | Flag route conflicts between workers |

### Step 3: Cross-Reference ChittyTrack

ChittyTrack (`track.chitty.cc`) is the centralized observability worker. Every production worker SHOULD have:

```toml
[[tail_consumers]]
service = "chittytrack"
```

Flag any worker missing this binding.

### Step 4: Compatibility Date Analysis

Today's date determines staleness. Report:
- **Current** (< 3 months old): No action needed
- **Aging** (3-6 months old): Recommend update at next deploy
- **Stale** (> 6 months old): Flag for immediate update
- **Ancient** (> 12 months old): Critical — may miss important runtime changes

### Step 5: Output Report

```markdown
## Wrangler Audit Report

### Summary
- Workers found: X
- Stale compatibility dates: X
- Missing tail consumers: X
- Route conflicts: X
- Issues found: X

### Per-Worker Assessment

| Worker | Compat Date | Age | Tail Consumer | Issues |
|--------|------------|-----|---------------|--------|
| ... | ... | ... | ... | ... |

### Issues

1. **[CRITICAL/WARNING/INFO]** description...

### Recommended Actions

1. ...
```

### Step 6: Optional Fix

If the user asks to fix issues, update the wrangler config:
- Update `compatibility_date` to today's date (YYYY-MM-DD)
- Add missing `[[tail_consumers]]` blocks
- Do NOT change routes, bindings, or environment configs without explicit confirmation
