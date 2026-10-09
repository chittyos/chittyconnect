# GitHub proxy: API key scoping

Every route under `/api/thirdparty/github/repos/...` runs one guard
(`githubGuard` in `src/api/routes/thirdparty.js`) before any call to GitHub.

## API_KEYS record fields (optional, opt-in)

| Field | Type | Values |
|-------|------|--------|
| `github_actions` | string[] | `"read"`, `"write"`, `"merge"` |
| `github_repos` | string[] | `"owner/repo"` or `"owner/*"` (case-insensitive) |

Example record (`key:<raw key>` in the `API_KEYS` KV namespace):

```json
{ "status": "active", "service": "chittyagent-autoassist",
  "github_actions": ["read", "write", "merge"], "github_repos": ["chittyos/*"] }
```

These are schema fields, not credentials.

## Rules

| Route | Needs |
|-------|-------|
| GET pulls, check-runs, status, contents | `read` + repo match |
| PUT contents | `write` + repo match |
| PUT pulls/:n/merge | `merge` + repo match |

- A key without both fields is denied with 403 `GITHUB_PROXY_FORBIDDEN` (fail closed).
- OAuth principals (`/mcp` tokens) are denied on every route, reads included.
  An OAuth grant has no repo allow-list, so any GitHub access through it would
  reach every repo the broker token can. Use a scoped API key instead.
- Synthetic principals (`public`, `cloudflare-access`, `oidc`) are always denied.
