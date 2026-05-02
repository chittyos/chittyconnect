#!/usr/bin/env bash
set -euo pipefail

# Render profile-specific MCP config snippets.
# Purpose: explicit split between ChatGPT MCP endpoints and non-ChatGPT MCP endpoints.

TARGET="${1:-all}" # chatgpt | claude | codex | all

render_chatgpt() {
  cat <<'EOF'
{
  "chatgpt_mcp": {
    "ch1tty_smart_mcp": {
      "url": "https://chatgpt.ch1tty.com/mcp",
      "bearer_token_env_var": "CHITTYAUTH_ISSUED_CH1TTY_SMART_MCP_TOKEN"
    },
    "chittymcp": {
      "url": "https://chatgpt.chitty.cc/mcp",
      "bearer_token_env_var": "CHITTYAUTH_ISSUED_CHITTYMCP_TOKEN"
    }
  }
}
EOF
}

render_claude() {
  cat <<'EOF'
{
  "mcpServers": {
    "ch1tty-primary": { "url": "https://mcp.ch1tty.com/mcp" },
    "ch1tty-fallback": { "url": "https://mcp.chitty.cc/mcp" }
  }
}
EOF
}

render_codex() {
  cat <<'EOF'
[mcp_servers.ch1tty-smart-mcp]
url = "https://chatgpt.ch1tty.com/mcp"
bearer_token_env_var = "CHITTYAUTH_ISSUED_CH1TTY_SMART_MCP_TOKEN"

[mcp_servers.chittymcp]
url = "https://chatgpt.chitty.cc/mcp"
bearer_token_env_var = "CHITTYAUTH_ISSUED_CHITTYMCP_TOKEN"

EOF
}

case "$TARGET" in
  chatgpt)
    render_chatgpt
    ;;
  claude)
    render_claude
    ;;
  codex)
    render_codex
    ;;
  all)
    echo "# --- ChatGPT profile ---"
    render_chatgpt
    echo
    echo "# --- Claude profile ---"
    render_claude
    echo
    echo "# --- Codex profile ---"
    render_codex
    ;;
  *)
    echo "Usage: $0 [chatgpt|claude|codex|all]" >&2
    exit 2
    ;;
esac
