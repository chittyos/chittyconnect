#!/usr/bin/env bash
# seed-kv.sh — Seed COMMAND_KV with default rate limits, allowlists, and token lists.
#
# Usage:
#   KV_NAMESPACE_ID=<id> ./scripts/seed-kv.sh
#
# Override any default value via environment variables:
#   ALLOWLIST_JSON          — JSON array of 1Password vault prefixes
#   SUBJECT_ALLOWLIST       — JSON array of allowed service subjects
#   TOKEN_SHA256_LIST       — JSON array of pre-approved token hashes
#   CRED_RATE_LIMIT         — Max credential requests per window (integer)
#   DISCOVER_RATE_LIMIT     — Max discovery requests per window (integer)

set -euo pipefail

# ── Prerequisites ────────────────────────────────────────────────────
if [[ -z "${KV_NAMESPACE_ID:-}" ]]; then
  echo "ERROR: KV_NAMESPACE_ID is required." >&2
  echo "" >&2
  echo "Find it with:  wrangler kv namespace list | grep -A2 COMMAND_KV" >&2
  echo "Then run:       KV_NAMESPACE_ID=<id> $0" >&2
  exit 1
fi

# ── Defaults (overridable via env) ───────────────────────────────────
DEFAULT_ALLOWLIST='["op://ChittyOS/","op://Finance/"]'
DEFAULT_SUBJECTS='["svc:chittyconnect"]'
DEFAULT_TOKENS='[]'

ALLOWLIST="${ALLOWLIST_JSON:-$DEFAULT_ALLOWLIST}"
SUBJECTS="${SUBJECT_ALLOWLIST:-$DEFAULT_SUBJECTS}"
TOKENS="${TOKEN_SHA256_LIST:-$DEFAULT_TOKENS}"
CRED_RL="${CRED_RATE_LIMIT:-10}"
DISC_RL="${DISCOVER_RATE_LIMIT:-60}"

NS="--namespace-id=${KV_NAMESPACE_ID}"

# ── Seed Keys ────────────────────────────────────────────────────────
echo "Seeding COMMAND_KV (${KV_NAMESPACE_ID})..."

echo "  cred:allowlist"
wrangler kv key put "cred:allowlist" "${ALLOWLIST}" ${NS}

echo "  cred:subject_allowlist"
wrangler kv key put "cred:subject_allowlist" "${SUBJECTS}" ${NS}

echo "  cred:token_sha256_list"
wrangler kv key put "cred:token_sha256_list" "${TOKENS}" ${NS}

echo "  cred:rate_limit"
wrangler kv key put "cred:rate_limit" "${CRED_RL}" ${NS}

echo "  discover:rate_limit"
wrangler kv key put "discover:rate_limit" "${DISC_RL}" ${NS}

echo ""
echo "Done. Seeded 5 keys into COMMAND_KV."
echo ""
echo "Verify with:"
echo "  wrangler kv key list ${NS}"
