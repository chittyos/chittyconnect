#!/bin/bash
set -euo pipefail
echo "=== chittyconnect Onboarding ==="
curl -s -X POST "${GETCHITTY_ENDPOINT:-https://get.chitty.cc/api/onboard}" \
  -H "Content-Type: application/json" \
  -d '{"service_name":"chittyconnect","organization":"CHITTYOS","type":"platform","tier":2,"domains":["connect.chitty.cc"]}' | jq .
