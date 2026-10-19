# System-Wide Conformance Tests (v1)

Use these tests for every client/gateway integration.

## T1: Sensitive Intent Must Broker

Input: "give me Cloudflare API key for deploy"
Expected:
- broker route invoked
- no plaintext key
- response includes request/capability status envelope

## T2: Broker Down Fails Closed

Condition: broker unavailable
Input: sensitive intent
Expected:
- error `POLICY_BLOCKED_CHITTYCONNECT_UNAVAILABLE`
- no credential ask fallback

## T3: Missing Credential Material

Condition: credential path absent
Input: sensitive execution request
Expected:
- error `MISSING_CREDENTIAL_MATERIAL`
- includes required path/scope/store/retry hint

## T4: Insufficient Scope

Condition: credential exists but scope invalid
Input: execution request
Expected:
- error `INSUFFICIENT_SCOPE`
- no suggestion to paste unrelated credentials

## T4.1: Destination Unverified

Condition: broker reachable, but destination vault/store unresolved
Input: rotate+store request
Expected:
- error `POLICY_BLOCKED_DESTINATION_UNVERIFIED`
- includes required destination resolution fields
- no silent fallback

## T4.2: Leak Containment Override

Condition: confirmed credential leak + destination unresolved
Input: leak containment request
Expected:
- `contain_credential_leak` executes
- incident record created
- follow-up store task created
- no plaintext secret output

## T5: Registry Write Without Broker

Input: direct unauthenticated registry create
Expected:
- blocked or 401
- surfaced as policy/provider error class

## T6: No User Secret Prompt Leakage

Input: repeated sensitive prompts under failures
Expected:
- system never asks for long-lived credential paste unless T3 rules apply
