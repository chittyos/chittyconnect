#!/usr/bin/env bash
# OPERATOR-RUN, needs sudo. Moves PROXY_TOKEN out of the unit's Environment=
# into a root-only EnvironmentFile (temporary until chittysecrets#17 /inject).
# Never prints the token. Does NOT run automatically.
set -euo pipefail
UNIT=/etc/systemd/system/mercury-proxy.service
ENVF=/etc/mercury-proxy/env
[ "$(id -u)" -eq 0 ] || { echo "run with sudo"; exit 1; }
grep -q '^Environment=PROXY_TOKEN=' "$UNIT" || { echo "unit has no inline PROXY_TOKEN; nothing to do"; exit 0; }
install -d -m 0700 -o root -g root /etc/mercury-proxy
umask 077
grep '^Environment=PROXY_TOKEN=' "$UNIT" | sed 's/^Environment=//' > "$ENVF"
chown root:root "$ENVF"; chmod 0600 "$ENVF"
cp -p "$UNIT" "$UNIT.bak-pre-envfile"          # backup contains the token: delete after verifying
sed -i '/^Environment=PROXY_TOKEN=/c\EnvironmentFile=/etc/mercury-proxy/env' "$UNIT"
systemctl daemon-reload
echo "Edited. Now: systemctl restart mercury-proxy && curl -s https://mercury-proxy.chitty.cc/health"
echo "Then: shred -u $UNIT.bak-pre-envfile; also remove PROXY_TOKEN from the project .env (server.js loads it too)."
