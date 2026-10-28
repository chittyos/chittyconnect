# Agent Runtime Broker Decision

Date: 2026-10-27
Status: IMPLEMENTED CANDIDATE
Canonical owner: ChittyConnect
Auth authority: ChittyAuth
Runtime executor: chittyagent-dispatch

## Decision

ChittyConnect brokers ChittyAgent runtime operations over authenticated REST. It does
not extend the deprecated ChittyConnect MCP surface and does not become an agent
runtime resolver.

For Anthropic Managed Agent reconciliation:

1. ChittyConnect receives an authenticated broker request.
2. It resolves the account-shared `CHITTYAUTH_MINT_SECRET` through the production
   Cloudflare Secrets Store binding.
3. It calls the existing `ChittyAuthService.mint()` RPC for exactly one short-lived
   scope: `agents:read` or `agents:write`, TTL 300 seconds.
4. It immediately uses that bearer on the private `SVC_AGENT_DISPATCH` binding.
5. The bearer is discarded with request-local state and is never returned or logged.
6. Dispatch remains responsible for its own scope validation and Anthropic provider
   execution through `@chittyos/agent-anthropic`.

## Authorization

- Inventory: normal authenticated ChittyConnect API access plus the internally minted
  `agents:read` bearer.
- Projection/adoption: ChittyConnect admin role/scope plus the internally minted
  `agents:write` bearer.
- ChittyAuth mint RPC remains protected by `CHITTYAUTH_MINT_SECRET`.
- `agents` is excluded from ChittyAuth's broad `all` scope expansion.

## Secret boundary

No raw ChittyAuth bearer is written to source, KV, D1, logs, responses, chat, or the
caller environment. Anthropic provider credentials remain behind the separate
dispatch -> ChittyConnect credential-resolution boundary.

## Failure behavior

Fail closed if:
- the mint-secret binding is absent or unresolvable;
- the ChittyAuth RPC binding is unavailable or refuses minting;
- the dispatch service binding is unavailable;
- the caller lacks admin authority for a projection mutation;
- the projection payload lacks canonical identity/name/model.

## Rollback

Remove:
- `/api/v1/agent-runtime/*` route;
- `CHITTYAUTH` service binding;
- `SVC_AGENT_DISPATCH` service binding;
- production `CHITTYAUTH_MINT_SECRET` binding.

No database/schema/registry migration is involved.
