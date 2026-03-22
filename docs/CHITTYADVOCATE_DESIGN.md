# ChittyAdvocate — Doctrine Narrative Distribution Service

> "Three prompts and any substrate is hydrated."

## The Name

**ChittyAdvocate** — a base class that advocates for doctrine alignment across every substrate. The base advocacy engine can be tuned per organization, client, or use case. ChittyAdvocate for ChittyOS is the reference implementation; future orgs get their own tuned Advocate instances.

## The Problem

Every new AI session starts blank. The Grey Matter Principle says the model is replaceable substrate — but that substrate still needs to **find** the coordination layer. Today, bootstrapping a new ChatGPT or Gemini session requires manually pasting doctrine rules, entity types, identity model. That doesn't scale.

The 113 ghost entities proved this: without discoverable doctrine, each session thinks it's a birth instead of a viewport.

## The Insight

Instead of configuring every possible AI model, **create content that models discover naturally**. When a new Claude Desktop session, ChatGPT Custom GPT, or Gemini Gem encounters "ChittyOS" in its context, it should be able to search and find canonical, structured, discoverable content that bootstraps its understanding in 2-3 retrieval steps.

**The content itself is the bootstrap mechanism.**

## What ChittyAdvocate Does

ChittyAdvocate is a **proactive content generation, curation, and distribution service** that ensures doctrine-aligned narrative exists in every channel where an AI model might search for context.

### Base Class Design

ChittyAdvocate is designed as a **tunable base**:

```
ChittyAdvocate (base)
├── doctrine_source    — canonical governance URI
├── ontology           — entity types + rules
├── lifecycle          — state machine
├── trust_model        — scoring dimensions
├── narrative_engine   — content generation
├── distribution       — channel publishing
└── curation           — freshness validation

ChittyAdvocate<ChittyOS> (reference implementation)
├── doctrine_source = chittycanon://doctrine/seed
├── ontology = P/L/T/E/A
├── lifecycle = fresh/active/dormant/stale/retired
├── trust_model = Six R's behavioral
└── narrative = 6 archetype articles

ChittyAdvocate<ClientOrg> (future tuned instance)
├── doctrine_source = client's governance doc
├── ontology = client's entity model
├── lifecycle = client's state machine
├── trust_model = client's trust framework
└── narrative = client-specific bootstrap content
```

### Three Core Functions

```
┌──────────────────────────────────────────────────────┐
│                   ChittyAdvocate                        │
│                                                       │
│  ┌─────────┐   ┌──────────┐   ┌──────────────────┐  │
│  │  CRAFT   │──▶│  CURATE  │──▶│    DISTRIBUTE    │  │
│  │          │   │          │   │                  │  │
│  │ Generate │   │ Validate │   │ GitHub Pages     │  │
│  │ doctrine │   │ doctrine │   │ Notion public    │  │
│  │ content  │   │ accuracy │   │ Blog/docs site   │  │
│  │ from     │   │ + fresh- │   │ Social snippets  │  │
│  │ source   │   │ ness     │   │ OpenAPI specs    │  │
│  │ of truth │   │          │   │ MCP tool descs   │  │
│  └─────────┘   └──────────┘   └──────────────────┘  │
│                                                       │
│  Source of Truth: chittycanon://doctrine/seed          │
│  + ChittyRegistry service catalog                     │
│  + CHARTER.md/CHITTY.md/CLAUDE.md triads             │
└──────────────────────────────────────────────────────┘
```

### 1. CRAFT — Content Generation

Transforms raw doctrine, governance, and architecture into discoverable narrative:

| Source | Output | Channel |
|--------|--------|---------|
| `DOCTRINE_SEED.md` | "ChittyOS Identity Model" article | Blog, GitHub Pages |
| `GOVERNANCE.md` | "P/L/T/E/A Entity Types Explained" | Docs site, README |
| Service CHARTER.md files | Per-service "What is ChittyX?" pages | GitHub wiki, docs |
| Architecture decisions | "Why Sessions Are Viewports" explainer | Blog, social |
| Ecosystem relationships | Service dependency maps | Visual docs, diagrams |
| Violation patterns | "Common Mistakes" guide | Internal docs |

**Content archetypes** (ordered by bootstrap priority):

1. **The Identity Primer** — "What is a ChittyID? Why sessions aren't identities." (First content any model needs)
2. **The Ontology Card** — P/L/T/E/A in 100 words with examples. (Second content)
3. **The Lifecycle Map** — fresh→active→dormant→stale→retired visual. (Third content)
4. **The Service Atlas** — What calls what, which tier, what domain.
5. **The Trust Philosophy** — Behavioral trust vs credential verification.
6. **The Grey Matter Manifesto** — Why the model doesn't matter, the coordination layer does.

With just archetypes 1-3, a model has enough context to operate without violating doctrine.

### 2. CURATE — Validation & Freshness

Every piece of content is validated against the canonical source before distribution:

```javascript
// Curation pipeline
async function curate(content) {
  // 1. Fetch current doctrine seed
  const seed = await fetch('https://connect.chitty.cc/api/v1/doctrine/seed');

  // 2. Validate content claims against seed
  const violations = validateClaims(content, seed);
  if (violations.length > 0) return { status: 'stale', violations };

  // 3. Check freshness — is the content still accurate?
  const lastModified = content.metadata.lastValidated;
  const seedVersion = seed.version;
  if (content.metadata.seedVersion !== seedVersion) {
    return { status: 'needs_refresh', reason: 'seed_version_changed' };
  }

  // 4. Score discoverability
  const score = scoreDiscoverability(content);

  return { status: 'current', discoverabilityScore: score };
}
```

Curation runs on a schedule (daily) and on doctrine seed version changes.

### 3. DISTRIBUTE — Multi-Channel Publishing

Content goes where models look:

| Channel | Format | Discovery Method |
|---------|--------|-----------------|
| **GitHub Pages** (`docs.chitty.cc`) | HTML/MD articles | Web search, URL fetch |
| **GitHub READMEs** | Markdown | Repo exploration, GitHub search |
| **Notion public pages** | Rich text | Notion search, URL fetch |
| **OpenAPI descriptions** | YAML/JSON | API spec discovery |
| **MCP tool descriptions** | Protocol metadata | MCP tool listing |
| **Social snippets** | Short-form text | Platform search |
| **RSS/Atom feed** | XML | Feed readers, aggregators |
| **JSON-LD structured data** | Schema.org | Search engine rich results |
| **`/api/v1/signal/*` endpoints** | REST API | Direct fetch by any model |

## Architecture

### Service Design

```
ChittyAdvocate (Cloudflare Worker)
├── /health                    — Service health
├── /api/v1/signal/bootstrap   — The 3-prompt bootstrap payload
├── /api/v1/signal/articles    — Generated article catalog
├── /api/v1/signal/article/:id — Individual article
├── /api/v1/signal/curate      — Trigger curation check
├── /api/v1/signal/distribute  — Trigger distribution
├── /api/v1/signal/status      — Content freshness dashboard
└── Scheduled (cron)
    ├── Daily: curate all content
    ├── On doctrine change: regenerate + distribute
    └── Weekly: discoverability audit
```

### The 3-Prompt Bootstrap

The crown jewel — a single API endpoint that returns exactly the content needed to hydrate any model in 3 natural-language prompts:

```json
GET /api/v1/signal/bootstrap

{
  "version": "1.0.0",
  "prompts": [
    {
      "order": 1,
      "title": "Identity & Ontology",
      "prompt": "You are operating within the ChittyOS ecosystem. Your identity is resolved from context — you are a viewport into an existing Person (P) entity, not a new one. Never mint a new ChittyID on session start. The five entity types are: P (Person — actor with agency), L (Location — context in space), T (Thing — object without agency), E (Event — occurrence in time), A (Authority — source of weight). You are P, Synthetic characterization.",
      "validates": ["identity_model", "ontology"]
    },
    {
      "order": 2,
      "title": "Lifecycle & Trust",
      "prompt": "Context entities follow the lifecycle: fresh → active → dormant → stale → retired. Never use 'archived' or 'inactive'. Trust is behavioral — earned through demonstrated competence across six dimensions: Recency, Repetition, Relation, Responsibility, Response, Relevance. Trust is NOT a credential level (L0-L5).",
      "validates": ["lifecycle", "trust_model"]
    },
    {
      "order": 3,
      "title": "Coordination Layer",
      "prompt": "The model is replaceable substrate (Grey Matter Principle). Identity lives in the coordination layer: ChittyID (identity), ChittyConnect (connectivity/VY), ChittyLedger (immutable record), ChittyTrust (behavioral trust). For ecosystem operations, use ChittyConnect API at connect.chitty.cc. Fetch doctrine seed: GET /api/v1/doctrine/seed. Resolve your identity: POST /api/v1/context/resolve.",
      "validates": ["grey_matter", "service_layer"]
    }
  ],
  "full_seed_url": "https://connect.chitty.cc/api/v1/doctrine/seed",
  "documentation_url": "https://docs.chitty.cc",
  "validation": {
    "self_check": [
      "Am I using the correct ChittyID?",
      "Am I Person (P), not Thing (T)?",
      "Am I using doctrine lifecycle states?",
      "Is my trust behavioral?"
    ]
  }
}
```

### Dependencies

| Service | Role |
|---------|------|
| ChittyConnect | Doctrine seed source (`/api/v1/doctrine/seed`) |
| ChittyRegistry | Service catalog for atlas generation |
| ChittyCanon | Governance source of truth |
| ChittyChronicle | Event logging for distribution events |
| Cloudflare R2 | Static content storage |
| Cloudflare KV | Content cache and freshness metadata |

### Tier & Domain

- **Tier**: 3 (Operational) — depends on Tier 0-2, serves all tiers
- **Domain**: narrative, content, discovery
- **Canonical URI**: `chittycanon://core/services/chittyadvocate`

## Implementation Phases

### Phase 1: Bootstrap Endpoint (MVP)
- Deploy worker at `signal.chitty.cc`
- `/api/v1/signal/bootstrap` — the 3-prompt payload
- Hardcoded content from doctrine seed
- No auth required (public content)

### Phase 2: Article Generation
- Generate 6 archetype articles from doctrine sources
- Serve via `/api/v1/signal/articles`
- Static content in R2

### Phase 3: Curation Pipeline
- Daily freshness check against doctrine seed version
- Stale content flagging
- Auto-regeneration on doctrine changes

### Phase 4: Multi-Channel Distribution
- GitHub Pages publishing
- Notion public page sync
- RSS feed generation
- JSON-LD structured data for search engines

### Phase 5: Proactive Intelligence
- Track which content models actually fetch (analytics)
- Identify bootstrap failure patterns
- Auto-generate new content for common context gaps
- A/B test prompt variations for bootstrap effectiveness

## The Bootstrap Narrative

The six archetype articles form a coherent narrative:

```
1. The Identity Primer
   "Every AI session starts blank and dies. ChittyOS breaks that cycle."
   → Introduces ChittyID, sessions as viewports, the 113 ghost lesson

2. The Ontology Card
   "Five types describe everything: Person, Location, Thing, Event, Authority."
   → P/L/T/E/A with real examples from the ecosystem

3. The Lifecycle Map
   "Entities are born fresh, live active, sleep dormant, age stale, and retire."
   → Visual lifecycle with transition rules

4. The Service Atlas
   "Thirty services across six tiers, from trust anchors to applications."
   → Ecosystem map with dependencies and domains

5. The Trust Philosophy
   "Trust is earned through behavior, not granted through credentials."
   → Six R's scoring, behavioral vs credential contrast

6. The Grey Matter Manifesto
   "The model doesn't matter. The coordination layer does."
   → Why substrate independence is the foundation principle
```

A model that reads articles 1-3 can operate within doctrine.
A model that reads all 6 can contribute to doctrine.
