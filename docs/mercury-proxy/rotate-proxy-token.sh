#!/usr/bin/env bash
# OPERATOR-RUN on chittyserv-vm, as the ubuntu user (it calls sudo itself).
#
# Rotates the mercury-proxy bearer (PROXY_TOKEN) and publishes the same value to
# Cloudflare Secrets Store as MERCURY_EGRESS_PROXY_TOKEN, which is the name
# chittyconnect asks ChittySecrets for (chittysecrets://mercury/egress/proxy-token).
#
# Supersedes move-proxy-token-to-envfile.sh: the old token is discarded, not moved.
# The new value is never printed, never placed in argv, never written outside
# /etc/mercury-proxy/env (root:root 0600) and the Secrets Store.
#
# Order is fail-closed: the Secrets Store create runs first and doubles as the
# permission probe. If it fails, nothing on this host is touched.
#
# Requires: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment
# (both are exported by ~/.profile), with Secrets Store write permission.
set -euo pipefail
set +x

STORE_ID=e914522471964c3c8cf1e601770edcc3
SECRET_NAME=MERCURY_EGRESS_PROXY_TOKEN
UNIT=/etc/systemd/system/mercury-proxy.service
ENVF=/etc/mercury-proxy/env
PROJECT_ENV=/home/ubuntu/projects/github.com/CHITTYOS/mercury-proxy/.env
RELAY=http://127.0.0.1:8790
API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID unset}/secrets_store/stores/$STORE_ID/secrets"

die() { echo "FAIL: $*" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] || die "run as ubuntu, not root (the CF token lives in the ubuntu env)"
[ -n "${CLOUDFLARE_API_TOKEN:-}" ] || die "CLOUDFLARE_API_TOKEN unset"
[ -f "$UNIT" ] || die "unit not found: $UNIT"
sudo -v || die "sudo required"

WORK="$(mktemp -d)"
chmod 0700 "$WORK"
trap 'rm -rf "$WORK"; unset T' EXIT
printf 'Authorization: Bearer %s\n' "$CLOUDFLARE_API_TOKEN" > "$WORK/cf.hdr"

# --- 0. Refuse to overwrite: the secret must not exist yet -----------------
PAGE=1
while :; do
  L="$(curl -sS -H @"$WORK/cf.hdr" "$API?per_page=100&page=$PAGE")"
  [ "$(echo "$L" | jq -r .success)" = "true" ] || { echo "$L" | jq -c '{success, errors}' >&2; die "cannot list Secrets Store"; }
  [ "$(echo "$L" | jq -r --arg n "$SECRET_NAME" '[.result[] | select(.name == $n)] | length')" = "0" ] \
    || die "$SECRET_NAME already exists in the store; refusing to overwrite (rotate it deliberately)"
  [ "$PAGE" -lt "$(echo "$L" | jq -r '.result_info.total_pages // 1')" ] || break
  PAGE=$((PAGE + 1))
done

# --- 1. Generate and publish to Secrets Store (permission probe) ----------
T="$(openssl rand -hex 32)"
RESP="$(jq -n --arg n "$SECRET_NAME" --arg v "$T" --arg c "mercury-proxy bearer (PROXY_TOKEN on chittyserv-vm), rotated $(date -u +%F)" \
  '[{name: $n, value: $v, scopes: ["workers"], comment: $c}]' \
  | curl -sS -X POST -H @"$WORK/cf.hdr" -H 'Content-Type: application/json' --data-binary @- "$API")"
if [ "$(echo "$RESP" | jq -r .success)" != "true" ]; then
  echo "$RESP" | jq -c '{success, errors}' >&2
  die "Secrets Store create failed; host untouched"
fi
echo "ok   1 $SECRET_NAME created in Secrets Store"

# --- 2. Root-only env file -------------------------------------------------
sudo install -d -m 0700 -o root -g root /etc/mercury-proxy
printf 'PROXY_TOKEN=%s\n' "$T" | sudo sh -c "umask 077 && cat > $ENVF.new && chown root:root $ENVF.new && mv -f $ENVF.new $ENVF"
echo "ok   2 $ENVF written (root:root 0600)"

# --- 3. Unit: drop the inline token, load the env file ----------------------
if sudo grep -qE '^Environment="?PROXY_TOKEN=' "$UNIT"; then
  sudo sed -i -E "/^Environment=\"?PROXY_TOKEN=/c\\EnvironmentFile=$ENVF" "$UNIT"
elif ! sudo grep -qx "EnvironmentFile=$ENVF" "$UNIT"; then
  sudo sed -i "/^\[Service\]/a EnvironmentFile=$ENVF" "$UNIT"
fi
sudo grep -qE 'PROXY_TOKEN=' "$UNIT" && die "unit still contains PROXY_TOKEN"
sudo systemctl daemon-reload
sudo systemctl restart mercury-proxy
sleep 2
systemctl is-active --quiet mercury-proxy || die "mercury-proxy not active after restart (journalctl -u mercury-proxy -n 30)"
echo "ok   3 unit uses EnvironmentFile; service restarted"

# --- 4. Blank the stale copy in the project .env (nothing loads it) --------
if [ -f "$PROJECT_ENV" ]; then
  sed -i -E 's/^PROXY_TOKEN=.*/PROXY_TOKEN=/' "$PROJECT_ENV"
  echo "ok   4 PROXY_TOKEN blanked in $PROJECT_ENV"
fi

# --- 5. Verify against the relay directly (no Mercury call) ---------------
printf 'Authorization: Bearer %s\n' "$T" > "$WORK/relay.hdr"
H="$(curl -s -o /dev/null -w '%{http_code}' "$RELAY/health")"
N="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$RELAY/proxy")"
A="$(curl -s -o "$WORK/a.json" -w '%{http_code}' -X POST -H @"$WORK/relay.hdr" "$RELAY/proxy")"
LEAK="$(systemctl show mercury-proxy -p Environment | grep -c PROXY_TOKEN || true)"
echo "     /health=$H  no-bearer=$N  new-bearer=$A  token-in-systemctl-show=$LEAK"
[ "$H" = "200" ] || die "/health expected 200"
[ "$N" = "401" ] || die "no-bearer expected 401 (is auth enabled?)"
[ "$A" = "400" ] && grep -q 'X-Mercury-Token header required' "$WORK/a.json" || die "new bearer expected 400 X-Mercury-Token header required"
[ "$LEAK" = "0" ] || die "PROXY_TOKEN still visible in systemctl show"
echo "ok   5 relay accepts only the new bearer; token no longer world-readable"

echo "DONE. Remaining: chittysecrets needs a MERCURY_EGRESS_PROXY_TOKEN secrets_store binding (and DO registration) before chittyconnect can resolve it."
