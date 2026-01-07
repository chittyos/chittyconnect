#!/usr/bin/env bash
#
# 1Password Secret Validation Hook for Claude Code
# Validates that required 1Password secrets are accessible before shell execution
#
# Based on: https://github.com/1Password/cursor-hooks
# Adapted for Claude Code and ChittyConnect
#

set -euo pipefail

# Configuration
LOG_FILE="${TMPDIR:-/tmp}/1password-claude-hooks.log"
CONFIG_FILE=".1password/environments.toml"
DEBUG="${DEBUG:-0}"

# Logging function
log() {
    local level="$1"
    shift
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$level] $*" >> "$LOG_FILE"
    if [[ "$DEBUG" == "1" ]]; then
        echo "[$level] $*" >&2
    fi
}

# Output JSON response for Claude Code
output_response() {
    local permission="$1"
    local message="${2:-}"

    if [[ -n "$message" ]]; then
        printf '{"permission":"%s","agent_message":"%s"}\n' "$permission" "$message"
    else
        printf '{"permission":"%s"}\n' "$permission"
    fi
}

# Check if 1Password CLI is installed and signed in
check_op_cli() {
    if ! command -v op &> /dev/null; then
        log "WARN" "1Password CLI not installed"
        return 1
    fi

    # Check if signed in (this is a quick check)
    if ! op account list &> /dev/null 2>&1; then
        log "WARN" "1Password CLI not signed in"
        return 1
    fi

    return 0
}

# Validate a single secret reference
validate_secret_ref() {
    local ref="$1"

    # Check if it's a valid op:// reference
    if [[ ! "$ref" =~ ^op:// ]]; then
        log "DEBUG" "Not a 1Password reference: $ref"
        return 0
    fi

    log "DEBUG" "Validating secret reference: $ref"

    # Try to read the secret (just validate it exists, don't output value)
    if op read "$ref" &> /dev/null 2>&1; then
        log "DEBUG" "Secret validated: $ref"
        return 0
    else
        log "ERROR" "Failed to validate secret: $ref"
        return 1
    fi
}

# Parse environments.toml for configured secrets
get_configured_secrets() {
    local config_path="$1"

    if [[ ! -f "$config_path" ]]; then
        log "DEBUG" "No config file found at $config_path"
        return
    fi

    # Extract secret_refs from TOML (basic parsing)
    grep -E '^\s*"?op://' "$config_path" 2>/dev/null | \
        sed 's/.*"\(op:\/\/[^"]*\)".*/\1/' | \
        sed "s/.*'\(op:\/\/[^']*\)'.*/\1/" || true
}

# Extract op:// references from command
extract_op_refs_from_command() {
    local command="$1"
    echo "$command" | grep -oE 'op://[^"'\''[:space:]]+' || true
}

# Main validation logic
main() {
    log "INFO" "1Password validation hook started"

    # Read input from stdin (Claude Code passes JSON)
    local input
    if [[ -t 0 ]]; then
        # Interactive mode (testing)
        input='{"command":"echo test","workspace_roots":["."]}'
    else
        input=$(cat)
    fi

    log "DEBUG" "Input received: $input"

    # Parse JSON input (macOS-compatible, no grep -P)
    local command workspace
    command=$(echo "$input" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
    command="${command:-}"
    workspace=$(echo "$input" | sed -n 's/.*"workspace_roots"[[:space:]]*:[[:space:]]*\[[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
    workspace="${workspace:-.}"

    log "DEBUG" "Command: $command"
    log "DEBUG" "Workspace: $workspace"

    # Skip validation for non-op commands (fail open)
    if [[ ! "$command" =~ "op " ]] && [[ ! "$command" =~ "op://" ]]; then
        log "DEBUG" "Command doesn't use 1Password, allowing"
        output_response "allow"
        exit 0
    fi

    # Check if op CLI is available
    if ! check_op_cli; then
        log "WARN" "1Password CLI not available, failing open"
        output_response "allow" "1Password CLI not available. Secrets may not be accessible."
        exit 0
    fi

    # Extract op:// references from the command
    local refs
    refs=$(extract_op_refs_from_command "$command")

    # Also check configured secrets if config exists
    local config_path="${workspace}/${CONFIG_FILE}"
    local configured_refs
    configured_refs=$(get_configured_secrets "$config_path")

    # Combine all refs
    local all_refs
    all_refs=$(echo -e "${refs}\n${configured_refs}" | sort -u | grep -v '^$' || true)

    if [[ -z "$all_refs" ]]; then
        log "DEBUG" "No secret references found, allowing"
        output_response "allow"
        exit 0
    fi

    log "INFO" "Validating $(echo "$all_refs" | wc -l | tr -d ' ') secret reference(s)"

    # Validate each reference
    local failed_refs=""
    while IFS= read -r ref; do
        [[ -z "$ref" ]] && continue
        if ! validate_secret_ref "$ref"; then
            failed_refs="${failed_refs}${ref}\n"
        fi
    done <<< "$all_refs"

    # Return result
    if [[ -n "$failed_refs" ]]; then
        local count
        count=$(echo -e "$failed_refs" | grep -c -v '^$' || echo "0")
        log "ERROR" "Validation failed for $count secret(s)"
        output_response "deny" "1Password secrets unavailable. Please unlock 1Password or sign in with 'op signin'. Failed: $count secret(s)"
        exit 0
    fi

    log "INFO" "All secrets validated successfully"
    output_response "allow"
}

# Run main
main "$@"
