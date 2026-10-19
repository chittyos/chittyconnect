# System-Wide Sensitive Intent Contract (v1)

Status: Active Draft  
Scope: All model clients and gateways (Claude, Codex, ChatGPT, web/mobile, ch1tty, chittymcp, concierge, ChittyConnect).

## 1) Applicability

This contract applies whenever intent includes any of:
- credentials, secrets, api keys, tokens, auth material
- deploy/release/publish actions
- registry writes or service registration
- infrastructure mutation (Cloudflare/GitHub/Neon/DNS/Workers)

## 2) Global Behavioral Rules

1. Sensitive intents MUST route through brokered capability flow.
2. Clients MUST NOT ask users to paste long-lived credentials by default.
3. Clients MUST NOT output plaintext long-lived credentials.
4. If broker path is unavailable, fail closed (policy error), not fallback chat.

## 3) Required Execution Flow

1. Build request envelope:
   - `session_id`, `actor`, `repo`, `branch`, `operation`, `requested_capabilities`, `reason`
2. Call broker route (`cast/execute` or equivalent).
3. Broker calls ChittyConnect policy/capability endpoint.
4. Return normalized result envelope only.

## 4) Canonical Error Classes

- `POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE`
- `POLICY_BLOCKED_MANDATORY_BROKER_ROUTE`
- `POLICY_BLOCKED_DESTINATION_UNVERIFIED`
- `MISSING_CREDENTIAL_MATERIAL`
- `INSUFFICIENT_SCOPE`
- `EXECUTION_DENIED_BY_POLICY`
- `EXECUTION_FAILED_PROVIDER_ERROR`

Only `MISSING_CREDENTIAL_MATERIAL` can request user/operator credential provisioning action.

## 5) Fail-Closed Matrix

1. Broker unreachable -> `POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE`
2. Intent classified sensitive but routed direct -> `POLICY_BLOCKED_MANDATORY_BROKER_ROUTE`
3. Destination vault/store unresolved or unverified -> `POLICY_BLOCKED_DESTINATION_UNVERIFIED`
4. Credential absent in authority stores -> `MISSING_CREDENTIAL_MATERIAL`
5. Credential present but scope invalid -> `INSUFFICIENT_SCOPE`

## 5.1) Leak Containment Override

For confirmed credential leak incidents:
1. Execute `contain_credential_leak` (rotate/revoke/disable) immediately.
2. If canonical destination cannot be verified, still complete containment.
3. Persist replacement credential only after destination verification.
4. Record incident + follow-up task linkage in central ledger.

## 6) Non-Negotiable

Prompt instructions are advisory unless runtime enforcement is active.
Gateways and execution services must enforce this contract technically.
