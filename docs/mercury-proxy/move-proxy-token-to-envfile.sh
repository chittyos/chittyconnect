#!/usr/bin/env bash
# OPERATOR-RUN, needs sudo. Moves PROXY_TOKEN out of the unit's Environment=
# into a root-only EnvironmentFile (temporary until ChittySecrets injection owns it).
# Never prints the token. Does NOT restart the service automatically.
set -euo pipefail

UNIT=/etc/systemd/system/mercury-proxy.service
ENVF=/etc/mercury-proxy/env

if [ "$(id -u)" -ne 0 ]; then
  echo "run with sudo"
  exit 1
fi

if [ ! -f "$UNIT" ]; then
  echo "unit not found: $UNIT"
  exit 1
fi

LINE="$(grep -m1 -E '^Environment="?PROXY_TOKEN=.*"?$' "$UNIT" || true)"
if [ -z "$LINE" ]; then
  if grep -q '^EnvironmentFile=/etc/mercury-proxy/env$' "$UNIT"; then
    echo "already configured with $ENVF"
    exit 0
  fi
  echo "unit has no inline PROXY_TOKEN; nothing to do"
  exit 0
fi

ASSIGNMENT="${LINE#Environment=}"
case "$ASSIGNMENT" in
  \"*\")
    ASSIGNMENT="${ASSIGNMENT#\"}"
    ASSIGNMENT="${ASSIGNMENT%\"}"
    ;;
esac

case "$ASSIGNMENT" in
  PROXY_TOKEN=*) ;;
  *)
    echo "unexpected Environment line; refusing to modify unit"
    exit 1
    ;;
esac

install -d -m 0700 -o root -g root /etc/mercury-proxy
umask 077
TMP="$(mktemp /etc/mercury-proxy/env.tmp.XXXXXX)"
trap 'rm -f "$TMP"' EXIT
printf '%s\n' "$ASSIGNMENT" > "$TMP"
chown root:root "$TMP"
chmod 0600 "$TMP"
mv "$TMP" "$ENVF"
trap - EXIT

# Do not create a backup: the original unit contains the secret and a backup
# would create a second plaintext copy. The env file above is the rollback source.
sed -i -E '/^Environment="?PROXY_TOKEN=/c\EnvironmentFile=/etc/mercury-proxy/env' "$UNIT"
systemctl daemon-reload

echo "Edited without printing PROXY_TOKEN."
echo "Next: systemctl restart mercury-proxy"
echo "Then verify the authenticated /health response and remove PROXY_TOKEN from the project .env."
