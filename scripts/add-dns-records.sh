#!/bin/bash
# Add missing DNS records for ChittyOS service subdomains
#
# Usage:
#   1. Create a Cloudflare API token at https://dash.cloudflare.com/profile/api-tokens
#      with Zone:DNS:Edit permission for chitty.cc
#   2. Export it: export CF_API_TOKEN="your-token-here"
#   3. Run: bash scripts/add-dns-records.sh
#
# All records are proxied AAAA 100:: (standard Cloudflare Workers pattern)

set -euo pipefail

ZONE_ID="7a4f759e0928fb2be4772a2f72ad0df2"

if [ -z "${CF_API_TOKEN:-}" ]; then
  echo "Error: CF_API_TOKEN not set"
  echo "Create one at: https://dash.cloudflare.com/profile/api-tokens"
  echo "Required permissions: Zone > DNS > Edit (for chitty.cc)"
  exit 1
fi

# All ChittyOS service subdomains that need DNS records
SUBDOMAINS=(
  # Tier 0 - Trust Anchors
  id
  # Tier 1 - Core Identity
  auth
  register
  # Tier 2 - Platform
  connect
  mcp
  router
  # Tier 3 - Operational
  monitor
  discovery
  beacon
  # Tier 4 - Domain
  evidence
  ledger
  chronicle
  canon
  intel
  score
  # Tier 5 - Application
  cases
  portal
  dashboard
  # Agents
  agent
  dna
  # Other
  registry
  get
)

echo "Adding DNS records for chitty.cc zone..."
echo ""

for sub in "${SUBDOMAINS[@]}"; do
  FQDN="${sub}.chitty.cc"

  # Check if record already exists
  EXISTS=$(curl -s \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?name=${FQDN}&type=AAAA" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('result',[])))" 2>/dev/null || echo "0")

  if [ "$EXISTS" != "0" ]; then
    echo "  [skip] ${FQDN} (already exists)"
    continue
  fi

  # Create proxied AAAA record pointing to 100::
  RESULT=$(curl -s -X POST \
    -H "Authorization: Bearer $CF_API_TOKEN" \
    -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records" \
    -d "{\"type\":\"AAAA\",\"name\":\"${sub}\",\"content\":\"100::\",\"ttl\":1,\"proxied\":true}")

  SUCCESS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',False))" 2>/dev/null || echo "False")

  if [ "$SUCCESS" = "True" ]; then
    echo "  [added] ${FQDN} -> AAAA 100:: (proxied)"
  else
    ERROR=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('errors',[{}])[0].get('message','unknown'))" 2>/dev/null || echo "unknown")
    echo "  [FAIL]  ${FQDN}: ${ERROR}"
  fi
done

echo ""
echo "Done. Verify with: dig @1.1.1.1 connect.chitty.cc AAAA +short"
