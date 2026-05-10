# Secrets Portal — Write-Scope Provisioning Runbook

**Scope:** Provisioning the two operator credentials that activate server-side
propagation in ChittyConnect's secrets portal. When both are absent, the worker
falls back to the existing encrypted-KV-only path with no behavior change.

---

## Architecture Decision

The runtime delivery target is the **Cloudflare Secrets Store**
(`e914522471964c3c8cf1e601770edcc3`) — one write fans out to all workers that
declare a binding for the secret name. This matches the existing `wrangler.jsonc`
pattern for all Mercury tokens and MCP tokens.

The per-script `PUT /workers/scripts/{name}/secrets` API is NOT used by default.
If you need to target a single worker that does not participate in the store,
raise it as a separate request — the propagator can be extended with a
`SECRETS_PORTAL_TARGET_WORKER` env var guard.

---

## Credential 1 — 1Password Connect Write-Scoped Token

### What it is
A 1Password Connect access token scoped for write operations (create/update items)
on the default portal vault. The existing `ONEPASSWORD_CONNECT_TOKEN` is
**read-only**; do not reuse it.

### Scopes/Permissions required
- Server: `https://1password-connect.chitty.cc`
- Vault: the vault whose ID is stored in `OP_VAULT_ID_DEFAULT`
- Permissions: **read + write** (create, read, update, delete items)

### How to provision
1. Log into the 1Password Business account.
2. Navigate to **Integrations → 1Password Connect → chittyconnect-server**.
3. Generate a new token titled `chittyconnect-portal-write`.
4. Grant it **read+write** access to vault `oxwo63jlcbo66c7kwx67lquw4i`
   (ChittyOS-Core / Infrastructure) or whichever vault you intend to use.
5. Store the token in 1Password under vault `ChittyOS-Core`, item `chittyconnect`,
   field `op_connect_write_token`.
6. Push to Cloudflare (both envs):

```bash
# Read token value from 1P; never paste it in chat
op read "op://ChittyOS-Core/chittyconnect/op_connect_write_token" | \
  wrangler secret put OP_CONNECT_WRITE_TOKEN --env staging

op read "op://ChittyOS-Core/chittyconnect/op_connect_write_token" | \
  wrangler secret put OP_CONNECT_WRITE_TOKEN --env production
```

### How to verify
```bash
curl -s -H "Authorization: Bearer $(op read 'op://ChittyOS-Core/chittyconnect/op_connect_write_token')" \
  "https://1password-connect.chitty.cc/v1/vaults" | jq '.[].name'
# Must list the target vault. If 403, the token lacks vault read scope.

curl -s -X POST \
  -H "Authorization: Bearer $(op read 'op://ChittyOS-Core/chittyconnect/op_connect_write_token')" \
  -H "Content-Type: application/json" \
  "https://1password-connect.chitty.cc/v1/vaults/oxwo63jlcbo66c7kwx67lquw4i/items" \
  -d '{"vault":{"id":"oxwo63jlcbo66c7kwx67lquw4i"},"title":"PORTAL_WRITE_VERIFY","category":"API_CREDENTIAL","fields":[{"id":"credential","type":"CONCEALED","label":"value","value":"verify-ok"}]}' \
  | jq '.id'
# Non-null ID = write confirmed. Delete the test item afterward.
```

### Rotation cadence
Rotate every 90 days or on any team-member offboarding.
Rotation: generate new token in 1P Connect UI → update 1P item → re-run the
`wrangler secret put` commands above → verify.

---

## Credential 2 — Cloudflare API Token (Secrets Store: Edit)

### What it is
An account-scoped Cloudflare API token that can create/update secrets in the
default Secrets Store. This is separate from the general `CLOUDFLARE_MAKE_API_KEY`
(which has broader scope).

### Scopes/Permissions required
- **Account:** ChittyCorp LLC (`0bc21e3a5a9de1a4cc843be9c3e98121`)
- **Permission:** `Workers Secrets Store — Edit`
- **IP restriction:** Add the egress IP of the ChittyConnect worker if Cloudflare
  supports IP restrictions for API tokens (as of 2025, this is available for
  non-Worker tokens; for Worker egress IPs, omit or use zone restriction instead).

### How to provision
1. Log into `dash.cloudflare.com` → **Profile → API Tokens → Create Token**.
2. Use **Custom Token**.
3. Set **Account → Workers Secrets Store → Edit** for account `ChittyCorp LLC`.
4. Set **TTL** to 1 year (renew annually).
5. Store the token in 1Password under vault `ChittyOS-Core`, item `chittyconnect`,
   field `cf_secrets_store_edit_token`.
6. Push to Cloudflare:

```bash
op read "op://ChittyOS-Core/chittyconnect/cf_secrets_store_edit_token" | \
  wrangler secret put SECRETS_PORTAL_CF_API_TOKEN --env staging

op read "op://ChittyOS-Core/chittyconnect/cf_secrets_store_edit_token" | \
  wrangler secret put SECRETS_PORTAL_CF_API_TOKEN --env production
```

### How to verify
```bash
curl -s -X POST \
  -H "Authorization: Bearer $(op read 'op://ChittyOS-Core/chittyconnect/cf_secrets_store_edit_token')" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/0bc21e3a5a9de1a4cc843be9c3e98121/secrets_store/stores/e914522471964c3c8cf1e601770edcc3/secrets" \
  -d '[{"name":"PORTAL_WRITE_VERIFY","value":"verify-ok","scopes":["workers"],"comment":"runbook-verify"}]' \
  | jq '.success'
# true = token has Secrets Store:Edit. Delete the test secret afterward.
```

### Rotation cadence
Rotate annually (Cloudflare API tokens can be given a hard TTL; set it to 365
days). Rotation: create new token → update 1P item → re-run `wrangler secret put`.

---

## Credential 3 — Default 1Password Vault ID

Not a secret but must be provisioned as a Wrangler secret so it can be overridden
per-envelope via `envelope.context.vaultId`:

```bash
# Value: the vault ID for the portal secrets vault (e.g., oxwo63jlcbo66c7kwx67lquw4i)
echo "oxwo63jlcbo66c7kwx67lquw4i" | wrangler secret put OP_VAULT_ID_DEFAULT --env staging
echo "oxwo63jlcbo66c7kwx67lquw4i" | wrangler secret put OP_VAULT_ID_DEFAULT --env production
```

---

## Activation Check

After all secrets are provisioned, hit the portal and verify the response includes
`"propagation":{"ok":true,...}`. If it shows `skipped:true`, one or more of the
three required bindings is missing — check `wrangler secret list --env production`.

---

## Unresolved Question (for operator)

The runbook and code default to **Cloudflare Secrets Store** as the runtime
delivery target (one write, all workers receive via their `secrets_store_secrets`
binding). If you need per-script delivery to a specific worker that is NOT bound
to the store, add `SECRETS_PORTAL_TARGET_WORKER` (the script name) and the
propagator can be extended with a per-script write branch. Flag this as a
follow-up in PR review if needed.
