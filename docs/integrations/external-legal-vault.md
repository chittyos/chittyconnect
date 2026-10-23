# External Legal Client-Vault Integration

ChittyConnect can broker **read-only** access to an external legal client vault
without copying the provider password into source code, Worker variables, logs,
or API responses.

The adapter is provider-neutral. Provider identity, account identity, client
scope, and credential names are runtime configuration and must not be committed
to this public repository.

## Architecture

```text
authenticated caller
      |
      v
ChittyConnect /api/thirdparty/legal-vault/*
      |
      +-- principal allowlist
      +-- HTTPS + host + client-path allowlist
      |
      v
SVC_SECRETS private service binding
      |
      +-- resolve chittysecrets:// reference
      +-- audit resolution
      |
      v
provider execution boundary
      |
      +-- GET/read operations only
      +-- POST permitted only for authentication
      +-- request-local cookie jar
      +-- redirect containment
      |
      v
external legal client vault
```

The provider password exists only long enough to construct the provider
authentication request. It is never returned by the ChittyConnect API.

## Runtime configuration

All values in this table are deployment configuration. Use synthetic examples
in source and tests.

| Variable | Required | Purpose |
|---|---:|---|
| `LEGAL_VAULT_BASE_URL` | yes | HTTPS origin for the vault, e.g. `https://vault.example.test` |
| `LEGAL_VAULT_PATH_PREFIX` | yes | Client boundary, e.g. `/client` |
| `LEGAL_VAULT_ALLOWED_HOSTS` | yes | Comma-separated provider hosts allowed for login/redirects |
| `LEGAL_VAULT_ALLOWED_PRINCIPALS` | yes | Comma-separated trusted API-key principal identifiers |
| `LEGAL_VAULT_LOGIN_EMAIL` | yes | Provider login principal; runtime-only |
| `LEGAL_VAULT_LOGIN_MODE` | no | `auto` (default), `basic`, or `form` |
| `LEGAL_VAULT_LOGIN_URL` | form | Login form URL |
| `LEGAL_VAULT_LOGIN_POST_URL` | no | Form submission URL; defaults to final login-page URL |
| `LEGAL_VAULT_USERNAME_FIELD` | form | Username/email form field |
| `LEGAL_VAULT_PASSWORD_FIELD` | form | Password form field |
| `LEGAL_VAULT_CSRF_FIELD` | no | Hidden CSRF form field to echo |
| `LEGAL_VAULT_LOGIN_EXTRA_FIELDS` | no | JSON object of provider-required static form fields |
| `LEGAL_VAULT_PASSWORD_SECRET_NAME` | yes | ChittySecrets logical secret name |
| `LEGAL_VAULT_PASSWORD_CREDENTIAL_REF` | yes | Opaque `chittysecrets://...` reference |
| `LEGAL_VAULT_MAX_REDIRECTS` | no | Redirect cap, 0-10; default 5 |

Do **not** add the password as a ChittyConnect Worker variable or repository
secret. The credential remains under ChittySecrets custody.

## Credential policy

Before release, confirm that the referenced ChittySecrets metadata permits the
private `service-binding:chittyconnect` resolver (or the currently approved
grant mechanism). A missing or unauthorized credential must fail closed.

ChittyConnect receives the value only at the provider execution boundary.
ChittySecrets records the resolution in its audit ledger. ChittyConnect must
not log the value, cookie contents, Authorization header, or form body.

## Provider protocol

### `auto`

The connector inspects the read target:

- HTTP Basic challenge -> retry with Basic authentication.
- HTML password form -> use form mode only when the runtime form fields are
  configured.
- Unknown auth protocol -> fail closed with
  `LEGAL_VAULT_PROTOCOL_UNCONFIGURED`.

### `basic`

The connector performs a read using HTTP Basic authentication. Redirects remain
inside `LEGAL_VAULT_ALLOWED_HOSTS`; an Authorization header is stripped when
the host changes.

### `form`

The connector:

1. GETs the configured login page.
2. Keeps cookies in a request-local jar.
3. Reads an optional hidden CSRF field.
4. POSTs the configured authentication form.
5. GETs the requested client-vault path with the resulting session.
6. Discards the cookie jar when the request ends.

Provider cookies and provider-specific session headers are never returned to
the caller.

## API

All endpoints inherit ChittyConnect's normal `/api/*` authentication and then
apply the narrower legal-vault principal allowlist.

### `GET /api/thirdparty/legal-vault/status`

Reports whether the generic runtime configuration is present. It does not
resolve or reveal a credential.

### `GET /api/thirdparty/legal-vault/probe?path=...`

Performs an unauthenticated provider probe and returns only sanitized transport
metadata: status, final host/path, detected authentication kind, and content
type. It never returns the provider body or credential material.

### `GET /api/thirdparty/legal-vault/read?path=...`

Resolves the credential through the private ChittySecrets service binding and
returns the provider content. The destination is restricted to the configured
vault host and path prefix. The response drops `Set-Cookie` and all
non-allowlisted provider headers and sets `Cache-Control: no-store`.

There is intentionally no external-vault write endpoint.

## Release checklist

1. Confirm provider hostname and exact client path from an authorized browser
   session.
2. Confirm the login protocol and, for form login, the exact field names and
   CSRF behavior.
3. Configure provider-specific runtime variables outside this public repo.
4. Confirm the ChittySecrets credential exists, is not retired, and is
   authorized for the ChittyConnect private service binding.
5. Validate `/status`.
6. Validate `/probe` against the configured target.
7. Validate one known read through `/read`.
8. Confirm logs contain no credentials, cookies, Authorization values, or form
   bodies.
9. Only then merge/deploy the provider configuration.
