---
uri: chittycanon://docs/tech/spec/synthetic-person-life-pathways-projection-contract
namespace: chittycanon://docs/tech
type: spec
version: 0.1.0
status: DRAFT
registered_with: chittycanon://core/services/canon
title: "Synthetic Person / Life Pathways Projection Contract"
certifier: chittycanon://core/services/chittycertify
visibility: INTERNAL
---

# Synthetic Person / Life Pathways Projection Contract

## 1. Purpose

This contract governs longitudinal memory for a canonical Synthetic Person `P`
without introducing a competing ontology, identity system, or authoritative data store.

It separates five concerns:

| Layer | Responsibility |
|---|---|
| ChittyCanon | Canonical P/L/T/E/A identities, epistemic semantics, and relationships |
| AI Search | Namespace and instance-level indexing, retrieval, and ranking |
| Synthetic Person (`P`) | Stable canonical identity anchor for longitudinal memory |
| `/life-pathways/` | Projection over the person's evolving experiences, relationships, claims, and knowledge |
| Epistemic semantics | Distinguish observations, propositions, claims, verifications, derivations, and unknowns |

The projection is a read/retrieval organization over canonically addressable knowledge.
It is not itself a source of truth.

## 2. Normative authority

### 2.1 ChittyCanon owns

ChittyCanon is authoritative for:

- canonical identity and entity type;
- the invariant that a Synthetic Person is `P`, never a new memory-specific type;
- semantic relationships among canonical entities;
- epistemic meaning and state;
- rules governing promotion from unverified to verified knowledge.

Canonical identity must remain stable across sessions, models, agents, applications,
and retrieval providers.

### 2.2 ChittyConnect / MemoryCloude owns

ChittyConnect may:

- resolve the active session to its bound Synthetic Person;
- enforce authorization for memory read/write;
- persist retained interaction material;
- project retained material into AI Search;
- retrieve semantically relevant material for the same authorized `P`;
- rebuild or repair disposable search projections.

ChittyConnect does not become the canonical authority for the truth of indexed material.

### 2.3 AI Search owns

AI Search may:

- index material supplied by authorized ChittyOS services;
- isolate retrieval by namespace and per-P instance;
- rank and return candidate material;
- support semantic recall across sessions belonging to the same `P`.

AI Search must never:

- mint canonical identities;
- determine epistemic truth;
- promote a derivation or claim to verified fact;
- silently merge contradictory objects;
- become the authoritative source merely because an item is indexed or highly ranked.

## 3. Architectural invariants

The following are binding:

1. `/life-pathways/` is a projection, not a new ontology class.
2. Canonical identities remain stable across sessions, agents, models, and applications.
3. Every epistemic object retains provenance, temporal context, and verification state.
4. Contradictions coexist until explicitly resolved; retrieval must not silently collapse them.
5. Memory retrieval is identity-scoped and authorization-controlled.
6. Derived knowledge must never be promoted to verified fact without evidence.
7. Retrieval results are candidate knowledge, not truth assertions.
8. Search indexes are disposable and rebuildable from authoritative sources.
9. A provider outage or missing instance must never trigger fallback to a shared cross-P index.
10. Legal/evidentiary corpora remain isolated from Synthetic Person memory unless an explicitly authorized projection references them without copying their authority.

## 4. Identity and scope contract

### 4.1 Subject

Each Life Pathways projection is anchored to exactly one canonical Synthetic Person:

```text
P (Synthetic)
  -> one authorized memory retrieval scope
  -> zero or more sessions
  -> one logical /life-pathways/ projection
```

The canonical `P` identity is the subject boundary. Session IDs are subordinate
context and may refine ranking, chronology, or relevance; they never authorize access.

### 4.2 Authorization

Memory read/write must resolve scope from the active session-to-Synthetic-Person binding
and independently verify that the authenticated principal is authorized for the bound `P`.

A caller-provided session ID, header, query parameter, requested ChittyID, or AI Search
instance name is never sufficient authority.

Cross-P retrieval is denied by default. It requires a separately authorized federation
path that is explicit about both source and target identities.

## 5. Life Pathways projection semantics

`/life-pathways/` organizes the longitudinal projection of what a Synthetic Person has
encountered, asserted, inferred, verified, disputed, learned, or left unresolved.

It may project:

- experiences and interactions;
- relationships to canonical P/L/T/E/A entities;
- observations;
- propositions;
- claims;
- verifications;
- derivations;
- unresolved questions and unknowns;
- decisions and outcomes when linked from authoritative event/ledger records;
- source references and proof references.

This contract does **not** define a new persistence schema. Implementations must use
existing ChittyOS canonical identities, metadata envelopes, source references, and
relationship mechanisms.

## 6. Epistemic semantics

Every projected knowledge object must retain a distinguishable epistemic role.

| Epistemic role | Meaning |
|---|---|
| Observation | A recorded perception or source-extracted statement, not yet asserted as true |
| Proposition | A statement capable of being evaluated, without an assertion of verification |
| Claim | A proposition asserted by an identified source or actor |
| Verification | A claim supported by sufficient evidence under the applicable verification workflow |
| Derivation | Knowledge computed, inferred, summarized, or synthesized from other objects |
| Unknown | A material question or state for which the system lacks sufficient support |

These are semantic roles, not new P/L/T/E/A ontology classes.

### 6.1 Required logical attributes

Regardless of physical serialization, an epistemic projection must preserve enough
information to recover:

- the canonical subject identity;
- the epistemic role;
- provenance/source reference;
- temporal context;
- verification status;
- source or parent object references for derivations;
- contradiction or supersession relationships when known.

A serialization that drops any of these is non-compliant with this contract.

## 7. Contradiction contract

Contradiction is a first-class retrieval condition, not a write conflict.

When two supported objects disagree:

- both remain addressable;
- neither may silently overwrite the other;
- provenance for each remains intact;
- retrieval may rank one above another but must not present ranking as resolution;
- a resolving object must explicitly reference the conflicting objects and the evidence or authority used to resolve them;
- unresolved contradiction must remain visible to downstream reasoning.

A later statement does not become true merely because it is later.

## 8. Retrieval guarantees

An implementation conforming to this contract must guarantee:

### 8.1 Isolation

- one authorized memory scope per Synthetic Person;
- no cross-P retrieval through shared default instances;
- session narrowing occurs inside the P scope, never instead of it.

### 8.2 Epistemic preservation

Returned material must preserve enough metadata for the caller to distinguish:

- verified from unverified;
- source statement from derivation;
- current from historical context;
- resolved from unresolved contradiction.

### 8.3 Source recoverability

A retrieval result must remain traceable to its source or authoritative reference.
A generated answer or semantic summary is never a substitute for that reference.

### 8.4 Non-authority of rank

Similarity score, recency, frequency, model confidence, or retrieval rank must never
be interpreted as verification state.

### 8.5 Fail-closed behavior

If identity scope or authorization cannot be resolved, the system must refuse the
memory operation rather than use a shared or guessed scope.

## 9. Write boundaries

### 9.1 Permitted projection writes

Authorized runtime services may write projection material that is:

- identity-bound to the active canonical `P`;
- provenance-bearing;
- temporally contextualized;
- epistemically labeled;
- linked to source or parent objects where applicable.

### 9.2 Forbidden promotion

No retrieval layer, summarizer, LLM, agent, or projection writer may transform:

- observation -> verification;
- proposition -> verification;
- claim -> verification;
- derivation -> verification;

without an evidence-backed verification action performed by the authoritative
verification path.

### 9.3 Derived knowledge

Derived knowledge must retain its derivation status and references to the inputs from
which it was produced.

If those inputs are later corrected, withdrawn, contradicted, or invalidated, the
derived object must remain historically addressable but must not masquerade as an
independent verified fact.

## 10. Failure semantics

| Failure | Required behavior |
|---|---|
| No active P binding | Refuse read/write; fail closed |
| Authenticated principal does not match authorized P | Refuse read/write |
| Caller asserts a mismatched ChittyID | Refuse read/write |
| AI Search namespace/instance unavailable | Do not fall back to shared/default scope |
| Indexing fails after authoritative persistence succeeds | Preserve authoritative data; mark projection repairable |
| Required provenance missing | Reject or quarantine from normal knowledge promotion/retrieval |
| Verification proof missing | Treat as unverified; never synthesize a verified state |
| Contradictory objects exist | Return separately or explicitly surface contradiction |
| Index is stale | Preserve source timestamps/freshness and do not imply current truth |
| Retrieval returns only a generated synthesis | Require source references before truth-bearing downstream use |

## 11. Current implementation mapping

As of this contract's drafting, ChittyConnect already implements several required
invariants:

- memory scope resolves from active `context_session_bindings` to a canonical Synthetic Person;
- the authenticated principal must match the bound `P`;
- one provider-safe `memory-<P_ID>` AI Search instance is used per Synthetic Person;
- missing scope fails closed;
- cross-P shared fallback instances are denied.

The current runtime stores AI Search projection items under the physical key prefix
`experiences/` and describes this as an Experience Projection.

This contract establishes `/life-pathways/` as the canonical logical projection name.
The existing `experiences/` prefix is therefore a legacy implementation detail, not a
second ontology or competing conceptual model.

No implementation may create a separate database, entity type, or authoritative store
to implement `/life-pathways/`.

## 12. Compatibility and migration rule

Migration from the legacy `experiences/` physical prefix to the Life Pathways
projection must preserve continuity and provenance.

Until an implementation change is approved and verified:

- existing `experiences/` items remain readable;
- no destructive rewrite is implied by this contract;
- existing canonical P identities remain unchanged;
- the memory AI Search namespace and per-P instance boundary remain unchanged.

A later implementation plan may change physical keys or add read compatibility, but it
must not change the identity model or create a parallel store.

## 13. Data flow

```text
authoritative source / interaction / event
                |
                v
        canonical identity binding
                |
                v
       epistemic classification
                |
                v
 provenance + time + verification state
                |
                v
     Life Pathways projection material
                |
                v
 per-P AI Search instance (retrieval index)
                |
                v
         candidate retrieval
                |
                v
 source resolution / verification as needed
```

The downward path creates retrieval affordances. It does not reverse authority:
AI Search cannot make an upstream source canonical.

## 14. Conformance tests

An implementation is conformant only if tests demonstrate at minimum:

1. two Synthetic Persons resolve to distinct retrieval instances;
2. non-P and malformed identities cannot resolve memory scope;
3. an unbound session cannot read or persist semantic memory;
4. a mismatched authenticated principal is denied;
5. no shared/default AI Search fallback is reachable;
6. cross-session recall works inside one authorized P;
7. cross-P recall is denied without explicit federation authorization;
8. contradictory objects can coexist without overwrite;
9. derivations remain distinguishable from verified facts;
10. retrieval results retain source/provenance references;
11. index failure does not corrupt or overwrite the authoritative source;
12. legacy `experiences/` material remains recoverable during migration.

## 15. Non-goals

This contract does not:

- create a new ontology class;
- create a new database or schema;
- replace ChittyCanon;
- replace ChittyLedger, ChittyEvidence, ChittyDNA, or other authoritative systems;
- make AI Search authoritative;
- authorize cross-person search;
- define a new truth score;
- require automatic resolution of contradictions;
- define retention durations beyond those already governed by the owning runtime.

## 16. Acceptance criteria for ratification

The contract may advance from `DRAFT` only when:

- ChittyCanon semantics and P/L/T/E/A usage are confirmed consistent;
- ChittyConnect's CHARTER.md, CHITTY.md, and AGENTS.md reference the same projection contract without contradicting it;
- runtime migration behavior is separately planned and tested;
- authorization tests remain fail-closed;
- no new persistence schema or competing canonical store is introduced;
- AI Search remains an index/retrieval layer, not a truth authority.
