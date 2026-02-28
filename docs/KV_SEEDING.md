# KV Seeding — COMMAND_KV

The `COMMAND_KV` namespace stores configuration that controls credential access, rate limits, and allowlists for ChittyConnect's command layer. The `scripts/seed-kv.sh` script seeds this namespace with sensible defaults.

## Prerequisites

1. **Wrangler CLI** authenticated (`wrangler login` or `CLOUDFLARE_API_TOKEN` set)
2. A **COMMAND_KV namespace** created in Cloudflare Workers KV
3. The namespace **bound** in `wrangler.toml` as `COMMAND_KV`

If the namespace does not yet exist, create it:

```bash
wrangler kv namespace create COMMAND_KV
```

Then add the binding to `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "COMMAND_KV"
id = "<namespace-id-from-above>"
```

## Finding the Namespace ID

```bash
wrangler kv namespace list
```

Look for the entry with title containing `COMMAND_KV`. The `id` field is what you need.

Alternatively, if you just created it, the ID is printed in the creation output.

## Running the Seed Script

```bash
KV_NAMESPACE_ID=<your-namespace-id> ./scripts/seed-kv.sh
```

## Default Seed Values

| KV Key                     | Type       | Default Value                                | Purpose                              |
|----------------------------|------------|----------------------------------------------|--------------------------------------|
| `cred:allowlist`           | JSON array | `["op://ChittyOS/","op://Finance/"]`         | 1Password vault prefixes allowed for credential resolution |
| `cred:subject_allowlist`   | JSON array | `["svc:chittyconnect"]`                      | Service subjects permitted to request credentials |
| `cred:token_sha256_list`   | JSON array | `[]`                                         | Pre-approved token SHA-256 hashes    |
| `cred:rate_limit`          | number     | `10`                                         | Max credential requests per rate-limit window |
| `discover:rate_limit`      | number     | `60`                                         | Max discovery requests per rate-limit window |

## Customizing Values

Override any default by setting the corresponding environment variable before running the script:

```bash
export KV_NAMESPACE_ID=abc123def456

# Custom allowlist with an additional vault
export ALLOWLIST_JSON='["op://ChittyOS/","op://Finance/","op://Legal/"]'

# Allow two service subjects
export SUBJECT_ALLOWLIST='["svc:chittyconnect","svc:chittyauth"]'

# Pre-approve a specific token hash
export TOKEN_SHA256_LIST='["a1b2c3d4e5f6..."]'

# Increase rate limits
export CRED_RATE_LIMIT=25
export DISCOVER_RATE_LIMIT=120

./scripts/seed-kv.sh
```

### Environment Variable Reference

| Env Var               | Overrides KV Key             | Format     |
|-----------------------|------------------------------|------------|
| `ALLOWLIST_JSON`      | `cred:allowlist`             | JSON array |
| `SUBJECT_ALLOWLIST`   | `cred:subject_allowlist`     | JSON array |
| `TOKEN_SHA256_LIST`   | `cred:token_sha256_list`     | JSON array |
| `CRED_RATE_LIMIT`     | `cred:rate_limit`            | integer    |
| `DISCOVER_RATE_LIMIT` | `discover:rate_limit`        | integer    |

## Computing Token SHA-256 Hashes

To add a token to `cred:token_sha256_list`, you need its SHA-256 hash (hex-encoded). This ensures the raw token is never stored in KV.

### Using OpenSSL (macOS / Linux)

```bash
echo -n "your-secret-token" | openssl dgst -sha256 | awk '{print $NF}'
```

### Using shasum

```bash
echo -n "your-secret-token" | shasum -a 256 | awk '{print $1}'
```

### Using Node.js

```bash
node -e "const crypto = require('crypto'); console.log(crypto.createHash('sha256').update('your-secret-token').digest('hex'))"
```

### Adding the Hash

Take the output (a 64-character hex string) and include it in the array:

```bash
export TOKEN_SHA256_LIST='["e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"]'
KV_NAMESPACE_ID=<id> ./scripts/seed-kv.sh
```

## Verifying Seeded Values

After running the seed script, verify the keys were written:

```bash
# List all keys in the namespace
wrangler kv key list --namespace-id=<id>

# Read a specific key
wrangler kv key get "cred:allowlist" --namespace-id=<id>
wrangler kv key get "cred:rate_limit" --namespace-id=<id>
```

## Updating Individual Keys

To update a single key without re-running the full seed:

```bash
wrangler kv key put "cred:rate_limit" "20" --namespace-id=<id>
```

## Deleting a Key

```bash
wrangler kv key delete "cred:token_sha256_list" --namespace-id=<id>
```
