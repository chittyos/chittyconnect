#!/usr/bin/env bash
set -euo pipefail

: "${CHITTYCONNECT_API_KEY:?CHITTYCONNECT_API_KEY is required}"
ENTITY_DIR="${CHITTYENTITY_DIR:-chittyentity}"
BASE_URL="${CHITTYCONNECT_URL:-https://connect.chitty.cc}"
INVENTORY_URL="$BASE_URL/api/v1/agent-runtime/anthropic/agents"
PROJECT_URL="$BASE_URL/api/v1/agent-runtime/anthropic/project"

for cmd in curl jq node npm; do
  command -v "$cmd" >/dev/null || { echo "missing required command: $cmd" >&2; exit 2; }
done

[ -f "$ENTITY_DIR/scripts/render-anthropic-fabric-agent.mjs" ] || {
  echo "missing canonical renderer under $ENTITY_DIR" >&2
  exit 2
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The canonical renderer imports yaml from its own module location. Copy it into
# an isolated temporary package so reconciliation does not install or mutate the
# chittyentity workspace.
mkdir -p "$tmp/renderer"
cp "$ENTITY_DIR/scripts/render-anthropic-fabric-agent.mjs" "$tmp/renderer/render.mjs"
npm install --prefix "$tmp/renderer" --no-save --ignore-scripts --silent yaml@2.9.0 >/dev/null

auth_header="Authorization: Bearer $CHITTYCONNECT_API_KEY"

inventory() {
  curl --fail-with-body --silent --show-error     -H "$auth_header"     "$INVENTORY_URL"
}

render_agent() {
  local slug="$1"
  (
    cd "$ENTITY_DIR"
    node "$tmp/renderer/render.mjs" "$slug"
  )
}

provider_ref_by_name() {
  local file="$1" name="$2"
  local count
  count="$(jq --arg name "$name" '[.agents[] | select(.name == $name)] | length' "$file")"
  if [ "$count" != "1" ]; then
    echo "expected exactly one provider projection named $name; found $count" >&2
    exit 3
  fi
  jq -r --arg name "$name" '.agents[] | select(.name == $name) | .id' "$file"
}

project_agent() {
  local slug="$1" provider_name="$2" inventory_file="$3"
  local ref payload_file response_file version operation
  ref="$(provider_ref_by_name "$inventory_file" "$provider_name")"
  payload_file="$tmp/$slug-payload.json"
  response_file="$tmp/$slug-response.json"

  render_agent "$slug"     | jq --arg ref "$ref" '. + {target: {deploymentRef: $ref}}'     > "$payload_file"

  curl --fail-with-body --silent --show-error     -X POST "$PROJECT_URL"     -H "$auth_header"     -H "Content-Type: application/json"     --data-binary @"$payload_file"     > "$response_file"

  jq -e '.success == true and (.operation == "updated" or .operation == "created")'     "$response_file" >/dev/null

  version="$(jq -r '.projection.version // "unknown"' "$response_file")"
  operation="$(jq -r '.operation' "$response_file")"
  echo "$provider_name: $operation (provider version $version)"
}

echo "Fetching current Anthropic projection inventory..."
inventory > "$tmp/before.json"
jq -e '.success == true and .runtime == "anthropic-managed" and (.agents | type == "array")'   "$tmp/before.json" >/dev/null

# Specialists first. Their canonical metadata must exist before Chief is updated,
# because the provider adapter resolves Chief's canonical specialist roster from
# this metadata and pins current provider versions.
project_agent gov ChittyGov "$tmp/before.json"
project_agent dev ChittyDev "$tmp/before.json"
project_agent audit ChittyAudit "$tmp/before.json"
project_agent adversary ChittyAdversary "$tmp/before.json"

# Refresh after specialist adoption so the operator log proves the metadata is
# visible before Chief reconciliation.
inventory > "$tmp/after-specialists.json"

for pair in   "ChittyGov:chittygov"   "ChittyDev:chittydev"   "ChittyAudit:chittyaudit"   "ChittyAdversary:chittyadversary"
do
  name="${pair%%:*}"
  canonical="${pair#*:}"
  count="$(jq --arg c "$canonical" '[.agents[] | select(.metadata.chittyos_canonical_agent_id == $c)] | length' "$tmp/after-specialists.json")"
  [ "$count" = "1" ] || {
    echo "specialist metadata verification failed for $name ($canonical): count=$count" >&2
    exit 4
  }
  multi="$(jq -r --arg c "$canonical" '.agents[] | select(.metadata.chittyos_canonical_agent_id == $c) | (.multiagent == null)' "$tmp/after-specialists.json")"
  [ "$multi" = "true" ] || {
    echo "specialist $name unexpectedly has multiagent configuration" >&2
    exit 4
  }
done

project_agent chief ChittyChief "$tmp/before.json"

echo "Verifying final canonical projection state..."
inventory > "$tmp/after.json"

for pair in   "ChittyChief:chittychief"   "ChittyGov:chittygov"   "ChittyDev:chittydev"   "ChittyAudit:chittyaudit"   "ChittyAdversary:chittyadversary"
do
  name="${pair%%:*}"
  canonical="${pair#*:}"
  by_name="$(jq --arg n "$name" '[.agents[] | select(.name == $n)] | length' "$tmp/after.json")"
  by_canonical="$(jq --arg c "$canonical" '[.agents[] | select(.metadata.chittyos_canonical_agent_id == $c)] | length' "$tmp/after.json")"
  [ "$by_name" = "1" ] && [ "$by_canonical" = "1" ] || {
    echo "final verification failed for $name: name_count=$by_name canonical_count=$by_canonical" >&2
    exit 5
  }
done

chief_multi="$(jq -r '.agents[] | select(.metadata.chittyos_canonical_agent_id == "chittychief") | (.multiagent != null)' "$tmp/after.json")"
[ "$chief_multi" = "true" ] || {
  echo "final verification failed: ChittyChief has no multiagent configuration" >&2
  exit 5
}

# Print deployment metadata without provider IDs or credentials.
jq -r '
  .agents
  | map(select(.metadata.chittyos_canonical_agent_id | startswith("chitty")))
  | sort_by(.name)
  | .[]
  | "\(.name): canonical=\(.metadata.chittyos_canonical_agent_id) version=\(.version) multiagent=\(.multiagent != null)"
' "$tmp/after.json"

echo "FABRIC_RECONCILIATION_OK"
