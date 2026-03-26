---
name: ship
description: Development wrap-up lifecycle — preflight, brainstorm, checkpoint, cleanup, branch. Triggers on "/ship", "wrap up", "finish up", "ship it", "done for now".
user_invocable: true
triggers:
  - /ship
  - wrap up
  - finish up
  - ship it
  - done for now
  - close this out
---

# /ship — Development Wrap-Up

Automates the full end-of-cycle wrap-up: type-check, verify PRs, deploy health, brainstorm next steps, checkpoint context, clean up, and start fresh.

## Workflow

Execute these steps in order, with confirmation gates at destructive stages:

### Step 1: Gather Local Context

```bash
# Current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
# Last commit
LAST_COMMIT=$(git log -1 --oneline)
# Open PRs for this branch
OPEN_PRS=$(gh pr list --head "$BRANCH" --json title,url,state --jq '.[].title' 2>/dev/null || echo "none")
```

### Step 2: Run Preflight Checks

```bash
# Tests pass
npm test 2>&1 && echo "PASS" || echo "FAIL"

# No uncommitted changes
[ -z "$(git status --porcelain)" ] && echo "PASS" || echo "FAIL"

# PR status: Check if PRs are merged
gh pr list --head "$BRANCH" --state open --json number --jq length

# Health check
curl -s https://connect.chitty.cc/health | jq -r '.status // "DOWN"'
```

Show results as a checklist to the user. If any checks FAIL, ask whether to proceed or fix first.

### Step 3: Brainstorm Next Steps

Gather context:

```bash
# Commits since diverging from main
git log main..HEAD --oneline

# TODOs in modified files
git diff main --name-only | xargs grep -n 'TODO\|FIXME\|HACK' 2>/dev/null

# Open issues
gh issue list --limit 10 --json title,number --jq '.[] | "#\(.number) \(.title)"'
```

### Step 4: Checkpoint

Ask the user: **"Ready to checkpoint and clean up?"**

If yes, save session state using the `/checkpoint` skill workflow.

### Step 5: Cleanup

Ask the user for explicit confirmation before proceeding.

Execute cleanup:
- Stash or commit any remaining changes
- Clean up temp files if any

### Step 6: Branch Operations

Ask the user: **"Delete branch `{name}` and create new?"**

If confirmed:
```bash
git checkout main
git pull origin main
git branch -d {old-branch}
git push origin --delete {old-branch} 2>/dev/null
git checkout -b {new-branch}
```

### Step 7: Done

Show a final summary:
- Preflight results
- Brainstormed next steps (for reference)
- What was cleaned up
- New branch (if created)
- Checkpoint location (for recovery)

## Error Handling

- Never execute destructive operations (cleanup, branch delete) without explicit user confirmation
- If health check fails, flag but don't block the wrap-up
