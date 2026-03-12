# Integration: GAM -> Gmail API -> ChittyRouter

**Canonical URI**: `chittycanon://docs/ops/integration/gam-gmail-to-chittyrouter`
**Discovered**: 2026-03-12
**Status**: Proven

## Overview

This integration documents a practical bridge for moving email and attachments from Google Workspace Gmail into ChittyRouter intake addresses when the active Gmail MCP surface is limited to search, read, and draft creation.

The current proven pattern is:

1. Use Gmail MCP to find the target message and inspect metadata.
2. Use GAMADV-XTD3 (Google Apps Manager) under Google Workspace Domain-wide Delegation to download attachments and send a new message with those files attached.
3. Deliver the message to a ChittyRouter intake address such as `evidence@chitty.cc`.

## Discovery Basis

This document was validated against:

- ChittyConnect triad: `CHARTER.md`, `CHITTY.md`
- ChittyRouter triad: `/Users/nb/Desktop/Projects/github.com/CHITTYOS/chittyrouter/CHARTER.md`, `/Users/nb/Desktop/Projects/github.com/CHITTYOS/chittyrouter/CHITTY.md`
- ChittyRouter email config: `/Users/nb/Desktop/Projects/github.com/CHITTYOS/chittyrouter/wrangler.jsonc`
- ChittyRouter inbound handler: `/Users/nb/Desktop/Projects/github.com/CHITTYOS/chittyrouter/src/email/cloudflare-email-handler.js`

The ChittyRegistry endpoint `https://registry.chitty.cc/api/services` returned `Endpoint not found` on 2026-03-12, so local triad discovery was used as the fallback source of truth for this integration note.

## Components

| Component | Role |
|-----------|------|
| **Gmail MCP** | Searches mail, reads message content, and identifies attachments |
| **GAMADV-XTD3** | Downloads Gmail attachments and sends forwarded mail with attachments |
| **Google Workspace DWD** | Allows approved service-account impersonation for mail operations |
| **ChittyRouter** | Receives inbound mail at `*.chitty.cc` addresses and routes through its AI email pipeline |
| **Triage/Document/Evidence agents** | Classify, inspect attachments, and preserve evidence-chain context downstream |

## Verified Intake Addresses

The following ChittyRouter addresses and patterns are currently configured in `wrangler.jsonc`:

| Address or pattern | Purpose |
|--------------------|---------|
| `evidence@chitty.cc` | Evidence-oriented document intake |
| `intake@chitty.cc` | General intake |
| `legal@chitty.cc` | Legal-priority inbound communications |
| `calendar@chitty.cc` | Calendar and scheduling intake |
| `*@chitty.cc` | Catch-all worker route |
| `case-*@chitty.cc` | Case-scoped routing pattern |
| `matter-*@chitty.cc` | Matter-scoped routing pattern |

## Architecture

```text
Gmail (source mailbox)
  -> Gmail MCP: search, inspect, identify attachments
  -> GAM: saveattachments / sendemail with attach
  -> ChittyRouter email()
  -> EmailProcessor / AgentOrchestrator
  -> TriageAgent + downstream agents
  -> R2 / Durable Objects / ChittyOS integrations
```

Within ChittyRouter, the documented processing flow is consistent with:

- Cloudflare Email Workers receiving inbound mail
- `email()` dispatch into the email-processing path
- `EmailProcessor` invoking the Agents SDK pipeline
- downstream classification, attachment handling, and evidence-oriented agent work

## Usage

### Download attachments from a Gmail message

```bash
gam user USER@DOMAIN show messages ids MESSAGE_ID saveattachments targetfolder /tmp/staging
```

### Forward to ChittyRouter with attachment(s)

```bash
gam user USER@DOMAIN sendemail \
  recipient evidence@chitty.cc \
  subject "FWD: Document Title [CASE_ID]" \
  message "Case reference and forwarding context" \
  attach "/tmp/staging/document.pdf"
```

### Inspect message metadata before forwarding

```bash
gam user USER@DOMAIN print messages ids MESSAGE_ID showbody showattachments
```

## Proven Outcome

On 2026-03-12, this workflow was used successfully to forward three legal emails from a Google Workspace mailbox to `evidence@chitty.cc`, including PDF attachments.

Operator-specific message IDs, mailbox addresses, client IDs, and secret references are intentionally omitted from repository documentation. Preserve that material in case systems, ledgers, or secure operator notes instead of Git.

## Operational Notes

- GAM is a local operator tool, not a ChittyOS service.
- Domain-wide Delegation is high-trust access. Limit operator scope and review `gam oauth info` regularly.
- Keep service-account credentials in 1Password or equivalent secret storage. Do not commit credential paths, keys, or tokens.
- Prefer forwarding into the most specific ChittyRouter intake address available instead of relying on the catch-all route.

## Future MCP Work

This repo does not currently expose GAM-backed send/forward tools in `src/mcp/tool-registry.js` or `src/mcp/tool-dispatcher.js`.

If this workflow should become first-class, the likely additions are:

- `chitty_email_send` - send a message with attachment support through an approved local Gmail bridge
- `chitty_gmail_forward` - forward a Gmail message by ID, including downloaded attachments

That should be implemented as an explicit wrapper around a local operator-approved transport, not by embedding GAM-specific secrets or machine paths into ChittyConnect itself.
