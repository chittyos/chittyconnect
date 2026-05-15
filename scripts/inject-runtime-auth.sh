#!/usr/bin/env bash
set -euo pipefail

# Runtime auth injector for VM sessions.
# Canonical policy: CHITTYAUTH_ISSUED_* names are authoritative.

pick_value() {
  local current="$1"
  shift
  if [[ -n "${current:-}" ]]; then
    printf "%s" "$current"
    return
  fi
  for candidate in "$@"; do
    if [[ -n "${candidate:-}" ]]; then
      printf "%s" "$candidate"
      return
    fi
  done
}

CH1TTY_SMART="$(pick_value "${CHITTYAUTH_ISSUED_CH1TTY_SMART_MCP_TOKEN:-}" "${CH1TTY_SMART_MCP_TOKEN:-}")"
CHITTYMCP="$(pick_value "${CHITTYAUTH_ISSUED_CHITTYMCP_TOKEN:-}" "${CHITTYMCP_TOKEN:-}")"
NPM_ISSUED="$(pick_value "${CHITTYAUTH_ISSUED_NPM_TOKEN:-}" "${NPM_TOKEN:-}" "${NODE_AUTH_TOKEN:-}")"

if [[ -n "${CH1TTY_SMART:-}" ]]; then
  export CHITTYAUTH_ISSUED_CH1TTY_SMART_MCP_TOKEN="$CH1TTY_SMART"
fi

if [[ -n "${CHITTYMCP:-}" ]]; then
  export CHITTYAUTH_ISSUED_CHITTYMCP_TOKEN="$CHITTYMCP"
fi

if [[ -n "${NPM_ISSUED:-}" ]]; then
  export CHITTYAUTH_ISSUED_NPM_TOKEN="$NPM_ISSUED"
  export NPM_TOKEN="$NPM_ISSUED"
  export NODE_AUTH_TOKEN="$NPM_ISSUED"

  # Non-interactive npm auth for this VM user.
  umask 077
  touch "${HOME}/.npmrc"
  if grep -q '^//registry.npmjs.org/:_authToken=' "${HOME}/.npmrc" 2>/dev/null; then
    sed -i 's#^//registry.npmjs.org/:_authToken=.*#//registry.npmjs.org/:_authToken=${NPM_TOKEN}#' "${HOME}/.npmrc"
  else
    printf "//registry.npmjs.org/:_authToken=\${NPM_TOKEN}\n" >> "${HOME}/.npmrc"
  fi
fi

echo "runtime_auth_injection=ok"
echo "has_ch1tty_smart_token=$([[ -n "${CH1TTY_SMART:-}" ]] && echo true || echo false)"
echo "has_chittymcp_token=$([[ -n "${CHITTYMCP:-}" ]] && echo true || echo false)"
echo "has_npm_token=$([[ -n "${NPM_ISSUED:-}" ]] && echo true || echo false)"
