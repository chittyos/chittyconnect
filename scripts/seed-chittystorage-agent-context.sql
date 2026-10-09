-- ChittyConnect Prompt Registry: add the missing canonical storage agent context.
-- Source authority: chittyos/chittymarket/canonical/agents/chittystorage-sasquatch.md
-- Source blob SHA: ce048db93fa1c41a9122995e6cf59da68b2ec935
-- Operation: Idempotent *projection* into existing prompt_registry/prompt_versions.
-- Governance: author updates fail closed until the real service ChittyID is admitted.
-- Run through ChittyConnect-authorized migration and verify both tables; do not
-- substitute this file for live case/matter authorization or storage schema checks.

INSERT OR IGNORE INTO prompt_registry
(id,domain,version,base,layers,fallback,env_gate,author_gate,consumer_gate,created_by,changelog)
VALUES (
'agent:chittystorage-sasquatch',
'agents',
1,
'# ChittyStorage Sasquatch

MCP-hosted agent — context loaded on-demand from Prompt Registry.

## When to use
- Document storage, file management, R2 buckets
- Content-addressing, deduplication, ingestion
- Entity-document relationships, classification
- Legal holds, chain-of-custody audit trails
- Google Drive sync, storage topology audits

## Context loading
On invocation, call `agent_context` MCP tool with `agent_id: chittystorage-sasquatch`
to fetch the current versioned system prompt from chittyconnect''s Prompt Registry.
The MCP-hosted version reflects current storage schema, R2 topology,
and entity model — not a static snapshot.

## Fallback
If MCP is unreachable, the agent should state this limitation and proceed
with general ChittyOS storage knowledge rather than operating on stale context.

## Workflow
1. Identify scope: ingest, audit, classify, dedupe, or storage-topology.
2. Confirm canonical owner via `chittyos/chittystorage` CHARTER.md/CHITTY.md.
3. Validate against entity-document model in ChittyEvidence schema.
4. Preserve chain-of-custody: content-hash, sha256, R2 key, mtime.
5. Surface dupes and orphans; never delete by filename alone.
',
'[]',
'passthrough',
'{"production":"ai","staging":"ai","dev":"configurable","test":"deterministic"}',
'{"domain":"agents","allowedAuthors":[],"requireApproval":true}',
'{"allowedServices":["chittyagent-storage","chittystorage","chittyagent-orchestrator"],"allowedAgents":["chittystorage-sasquatch"],"scopeBoundaries":["storage"]}',
'chittyos-maintenance-2026-10-09',
'Approved canonical source projection pending service identity: chittyos/chittymarket canonical/agents/chittystorage-sasquatch.md blob ce048db93fa1c41a9122995e6cf59da68b2ec935; no private legal context included'
);

INSERT INTO prompt_versions
(prompt_id,version,base,layers,fallback,env_gate,author_gate,consumer_gate,changelog,created_by)
SELECT p.id,p.version,p.base,p.layers,p.fallback,p.env_gate,p.author_gate,p.consumer_gate,p.changelog,p.created_by
FROM prompt_registry p
WHERE p.id='agent:chittystorage-sasquatch' AND p.version=1
 AND NOT EXISTS (SELECT 1 FROM prompt_versions v WHERE v.prompt_id=p.id AND v.version=p.version);
