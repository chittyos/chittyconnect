#!/usr/bin/env bash
# OPERATOR-RUN, needs sudo. Moves PROXY_TOKEN out of the unit's Environment=
# into a root-only EnvironmentFile (temporary until chittysecrets#17 /inject).
# Never prints the token. Does NOT run automatically.
set -euo pipefail
UNIT=/etc/systemd/system/mercury-proxy.service
ENVF=/etc/mercury-proxy/env
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }
LINE="$(grep -E '^Environment=("PROXY_TOKEN=.*"|PROXY_TOKEN=.*)
chown root:root "$ENVF"; chmod 0600 "$ENVF"
# Do not create a backup: the original unit contains the secret and a backup
# would create a second plaintext copy. The env file above is the rollback source.
sed -i '/^Environment=PROXY_TOKEN=/c\EnvironmentFile=/etc/mercury-proxy/env' "$UNIT"
systemctl daemon-reload
echo "Edited. Now: systemctl restart mercury-proxy && curl -s https://mercury-proxy.chitty.cc/health"
echo "Then remove PROXY_TOKEN from the project .env (server.js loads it too). The root-only env file is the temporary rollback source."
 "$UNIT" | head -n 1 || true)"
[ -n "$LINE" ] || { echo "unit has no inline PROXY_TOKEN; nothing to do"; exit 0; }
install -d -m 0700 -o root -g root /etc/mercury-proxy
umask 077
ASSIGNMENT="${LINE#Environment=}"
case "$ASSIGNMENT" in
  \"*\") ASSIGNMENT="${ASSIGNMENT#\"}"; ASSIGNMENT="${ASSIGNMENT%\"}" ;;
esac
printf '%s\n' "$ASSIGNMENT" > "$ENVF"
chown root:root "$ENVF"; chmod 0600 "$ENVF"
# Do not create a backup: the original unit contains the secret and a backup
# would create a second plaintext copy. The env file above is the rollback source.
sed -i '/^Environment=PROXY_TOKEN=/c\EnvironmentFile=/etc/mercury-proxy/env' "$UNIT"
systemctl daemon-reload
echo "Edited. Now: systemctl restart mercury-proxy && curl -s https://mercury-proxy.chitty.cc/health"
echo "Then remove PROXY_TOKEN from the project .env (server.js loads it too). The root-only env file is the temporary rollback source."
