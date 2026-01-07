# 1Password Hooks for Claude Code

Pre-execution validation hooks that ensure 1Password secrets are accessible before Claude Code runs shell commands.

Based on [1Password Cursor Hooks](https://github.com/1Password/cursor-hooks), adapted for Claude Code and ChittyConnect.

## How It Works

```
Claude Code → beforeShellExecution → validate-secrets.sh → Allow/Deny
                                           ↓
                                    Check op:// refs
                                           ↓
                                    Validate with op CLI
```

## Features

- **Automatic Detection**: Scans commands for `op://` secret references
- **Pre-Validation**: Validates secrets are accessible before execution
- **Fail Open**: If 1Password is unavailable, warns but allows execution
- **Configurable**: Use `.1password/environments.toml` to specify required secrets
- **Logging**: Debug logs at `/tmp/1password-claude-hooks.log`

## Requirements

- [1Password CLI](https://developer.1password.com/docs/cli/) (`op`) installed
- Signed in to 1Password (`op signin`)
- Claude Code with hooks enabled

## Installation

The hooks are already configured in this repository. To use in another project:

1. Copy `.claude/hooks/1password/` to your project
2. Add hook configuration to `.claude/settings.local.json`:

```json
{
  "hooks": {
    "beforeShellExecution": [
      {
        "command": ".claude/hooks/1password/validate-secrets.sh"
      }
    ]
  }
}
```

## Configuration

### Option 1: Automatic Detection (Default)

The hook automatically detects `op://` references in commands:

```bash
# These commands trigger validation:
CLOUDFLARE_API_TOKEN="op://Private/cloudflare/token" op run -- wrangler deploy
op read "op://Private/database/connection_string"
```

### Option 2: Explicit Configuration

Create `.1password/environments.toml` to specify required secrets:

```toml
# Secrets required for this project
[[secrets]]
ref = "op://Private/cloudflare/api_token"
description = "Cloudflare API token for deployments"

[[secrets]]
ref = "op://Private/neon/database_url"
description = "Neon PostgreSQL connection string"

[[secrets]]
ref = "op://ChittyOS/chittyconnect/service_token"
description = "ChittyConnect service token"
```

## Behavior

| Scenario | Result |
|----------|--------|
| No `op://` refs in command | Allow |
| All secrets accessible | Allow |
| Some secrets inaccessible | Deny with message |
| 1Password CLI not installed | Allow (warn) |
| 1Password not signed in | Allow (warn) |

## Debugging

Enable debug mode:

```bash
DEBUG=1 echo '{"command":"op run -- echo test","workspace_roots":["."]}' | \
  .claude/hooks/1password/validate-secrets.sh
```

View logs:

```bash
tail -f /tmp/1password-claude-hooks.log
```

## Integration with ChittyConnect

ChittyConnect uses 1Password for all credentials:

| Secret | Reference |
|--------|-----------|
| Cloudflare Account ID | `op://Private/.../ChittyCorp LLC/account_id` |
| Cloudflare API Token | `op://Private/.../Global API Key/token` |
| Service Tokens | `op://ChittyOS/{service}/service_token` |

The hook ensures these are accessible before deployment commands.

## Security Notes

- Hook never logs or outputs actual secret values
- Uses `op read` validation (checks existence, not content)
- Follows "fail open" philosophy for developer experience
- All validation decisions are logged for audit

## Related Resources

- [1Password Developer Docs](https://developer.1password.com/)
- [1Password Cursor Hooks](https://github.com/1Password/cursor-hooks)
- [ChittyConnect 1Password Integration](../../ONEPASSWORD_INTEGRATION.md)
- [Claude Code Hooks Documentation](https://docs.anthropic.com/claude-code/hooks)
