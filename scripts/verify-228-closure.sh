#!/usr/bin/env bash
set -euo pipefail

CONNECT_URL="${CONNECT_URL:-https://connect.chitty.cc}"
ENTITY_URL="${ENTITY_URL:-https://agent.chitty.cc/git}"
DISPOSABLE_REPO="${DISPOSABLE_REPO:?set DISPOSABLE_REPO=owner/repo for an authorized disposable repository}"
VERIFY_CALLER_CHITTYID="${VERIFY_CALLER_CHITTYID:?set VERIFY_CALLER_CHITTYID to a real canonical ChittyID}"
VERIFY_TENANT_ID="${VERIFY_TENANT_ID:?set VERIFY_TENANT_ID}"
CHITTY_API_KEY="${CHITTY_API_KEY:?set CHITTY_API_KEY through the approved secret injection path}"
REMOTE_URL="${REMOTE_URL:-https://github.com/${DISPOSABLE_REPO}.git}"
VERIFY_EXPIRY="${VERIFY_EXPIRY:-1}"
TEST_BRANCH="p/verify-228/gate-check-$(date +%s)"
TARGET_REF="refs/heads/${TEST_BRANCH}"

auth=(-H "X-ChittyOS-API-Key: ${CHITTY_API_KEY}" -H "Content-Type: application/json")

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

echo "== Gates 1-3: runtime custody and authority =="
status_file="$(mktemp)"
status_code="$(curl -sS -o "${status_file}" -w "%{http_code}"   "${auth[@]}" "${CONNECT_URL}/api/v1/git/runtime/status")"
cat "${status_file}" | jq .
jq -e '
  .github_app_auth == "verified" and
  .secrets_broker_bound == true and
  .ledger_binding_bound == true and
  .signing_key_custody == "verified" and
  .capability_surface == "implemented" and
  .ready == true
' "${status_file}" >/dev/null || fail "runtime custody/status is not closure-ready (HTTP ${status_code})"
rm -f "${status_file}"

mint_cap() {
  local operation="$1"
  local ref="$2"
  local remote="$3"
  local body

  body="$(jq -cn     --arg caller "${VERIFY_CALLER_CHITTYID}"     --arg tenant "${VERIFY_TENANT_ID}"     --arg op "${operation}"     --arg repo "${DISPOSABLE_REPO}"     --arg ref "${ref}"     --arg remote "${remote}" '
      {
        caller_chittyid: $caller,
        tenant_id: $tenant,
        operation: $op,
        repo_path: $repo
      }
      + (if $ref != "" then {ref: $ref} else {} end)
      + (if $remote != "" then {remote: $remote} else {} end)
    ')"

  curl -sS -f -X POST "${CONNECT_URL}/api/v1/capabilities/mint"     "${auth[@]}" -d "${body}"
}

echo "== Gate 4: mint single-operation opaque capabilities =="
READ_MINT="$(mint_cap read "" "")"
COMMIT_MINT="$(mint_cap commit "${TARGET_REF}" "")"
PUSH_MINT="$(mint_cap push "${TARGET_REF}" "${REMOTE_URL}")"

READ_CAP="$(jq -r '.token' <<<"${READ_MINT}")"
COMMIT_CAP="$(jq -r '.token' <<<"${COMMIT_MINT}")"
PUSH_CAP="$(jq -r '.token' <<<"${PUSH_MINT}")"

for cap in "${READ_CAP}" "${COMMIT_CAP}" "${PUSH_CAP}"; do
  [[ "${cap}" == cap_* ]] || fail "mint did not return an opaque cap_* token"
  [[ "${cap}" != ghs_* && "${cap}" != ghp_* ]] || fail "provider credential leaked from mint"
done

echo "== Gate 5: real read -> signed commit -> push -> PR -> ledger receipts =="
TX_RES="$(curl -sS -f -X POST "${ENTITY_URL}/v1/execute-pr-transaction"   -H "Content-Type: application/json"   -d "$(jq -cn     --arg repo "${DISPOSABLE_REPO}"     --arg branch "${TEST_BRANCH}"     --arg read_cap "${READ_CAP}"     --arg commit_cap "${COMMIT_CAP}"     --arg push_cap "${PUSH_CAP}" '
      {
        repo: $repo,
        target_branch: $branch,
        capabilities: {
          read: $read_cap,
          commit: $commit_cap,
          push: $push_cap
        },
        files: [{
          path: "02_System_Instructions/VERIFY_228.md",
          content_utf8: "---\nconfig_version: \"1.0.0\"\n---\n# Gate 228 Verification\n"
        }],
        commit_message: "test(#228): verify brokered signed commit and ledger receipt",
        pr_title: "[Verify #228] Brokered GitOps Transaction",
        pr_body: "Automated verification of the #209 <-> #789 closure gate."
      }
    ')")"

jq -e '
  .commit_sha != null and
  .pr_number != null and
  .ledger_receipts.commit != null and
  .ledger_receipts.push != null and
  (.provider_credentials_exposed // false) == false
' <<<"${TX_RES}" >/dev/null || fail "transaction result is missing commit/PR/ledger proof or exposed provider credentials"

echo "== Gate 6: fail-closed scope and credential rejection =="

assert_inactive() {
  local token="$1"
  local expected_op="$2"
  local repo="$3"
  local ref="$4"
  local payload response_file code

  payload="$(jq -cn     --arg token "${token}"     --arg op "${expected_op}"     --arg repo "${repo}"     --arg ref "${ref}" '
      {token: $token, expected: {operation: $op, repo_path: $repo}}
      + (if $ref != "" then {expected: (.expected + {ref: $ref})} else {} end)
    ')"
  response_file="$(mktemp)"
  code="$(curl -sS -o "${response_file}" -w "%{http_code}" -X POST     "${CONNECT_URL}/api/v1/capabilities/introspect" "${auth[@]}" -d "${payload}")"
  jq -e '.active == false' "${response_file}" >/dev/null     || { cat "${response_file}" >&2; rm -f "${response_file}"; fail "expected inactive capability (HTTP ${code})"; }
  rm -f "${response_file}"
}

assert_inactive "${READ_CAP}" tag "${DISPOSABLE_REPO}" ""
assert_inactive "${READ_CAP}" read "chittyos/unauthorized-repo" ""
assert_inactive "ghs_SimulatedRawGitHubToken12345" read "${DISPOSABLE_REPO}" ""

if [[ "${VERIFY_EXPIRY}" == "1" ]]; then
  expires_at="$(jq -r '.expires_at' <<<"${READ_MINT}")"
  now_epoch="$(date +%s)"
  exp_epoch="$(date -d "${expires_at}" +%s 2>/dev/null || python3 - <<'PY' "${expires_at}"
import datetime, sys
print(int(datetime.datetime.fromisoformat(sys.argv[1].replace("Z","+00:00")).timestamp()))
PY
)"
  sleep_for="$(( exp_epoch - now_epoch + 2 ))"
  if (( sleep_for > 0 )); then sleep "${sleep_for}"; fi
  assert_inactive "${READ_CAP}" read "${DISPOSABLE_REPO}" ""
else
  fail "VERIFY_EXPIRY must remain enabled for a complete #228 closure proof"
fi

echo "ALL #228 CLOSURE GATES PASSED"
