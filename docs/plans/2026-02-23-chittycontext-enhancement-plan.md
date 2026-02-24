# ChittyContext Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform ChittyContext from static JSON-on-disk into an accountable synthetic entity backed by ChittyConnect, with auto-save/restore hooks, MCP bridge, and ChittyDNA/Ledger integration.

**Architecture:** Three layers — (A) local hooks + cache for offline resilience, (B) ChittyConnect D1 as source of truth via existing intelligence layer, (C) MCP bridge (`mcp.chitty.cc`) for runtime communication. Local hooks auto-resolve context on session start and commit experience on session end.

**Tech Stack:** Cloudflare Workers (D1, KV, Vectorize), Vitest, Bash hooks, `can chitty` CLI, MCP protocol

**Design Doc:** `docs/plans/2026-02-23-chittycontext-enhancement-design.md`

---

## Phase 1: Cardinal Remediation (Backend Fixes)

Fix canonical entity type violations in the ChittyConnect intelligence layer. All context entities must mint as Person (P), never Thing (T) or custom codes.

### Task 1: Fix entity_type in context-resolver.js mintChittyId()

**Files:**
- Modify: `src/intelligence/context-resolver.js:260-262`
- Test: `src/intelligence/__tests__/context-resolver.test.js` (create)

**Step 1: Write the failing test**

Create `src/intelligence/__tests__/context-resolver.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal mock of D1 database
function createMockDb() {
  const mockFirst = vi.fn().mockResolvedValue(null);
  const mockBind = vi.fn(() => ({ first: mockFirst, run: vi.fn() }));
  const mockPrepare = vi.fn(() => ({ bind: mockBind }));
  return { prepare: mockPrepare, _mockFirst: mockFirst, _mockBind: mockBind };
}

describe('ContextResolver', () => {
  describe('mintChittyId', () => {
    it('should use entity_type P (Person) when calling ChittyID service', async () => {
      let capturedBody;
      const mockFetch = vi.fn().mockImplementation(async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ chitty_id: '03-1-USA-1234-P-2602-0-01' }) };
      });
      vi.stubGlobal('fetch', mockFetch);

      const { ContextResolver } = await import('../context-resolver.js');
      const resolver = new ContextResolver({
        DB: createMockDb(),
        CHITTYID_SERVICE_URL: 'https://id.chitty.cc',
        CHITTY_ID_TOKEN: 'test-token',
      });

      await resolver.mintChittyId({
        projectPath: '/test/project',
        workspace: 'test',
        supportType: 'development',
        organization: 'CHITTYOS',
      });

      expect(capturedBody.entity_type).toBe('P');
      expect(capturedBody.entity_type).not.toBe('CONTEXT');
      expect(capturedBody.entity_type).not.toBe('T');

      vi.unstubAllGlobals();
    });
  });

  describe('fallback ChittyID generation', () => {
    it('should generate ChittyID with type P in the type position', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Service unavailable'));
      vi.stubGlobal('fetch', mockFetch);

      const { ContextResolver } = await import('../context-resolver.js');
      const resolver = new ContextResolver({
        DB: createMockDb(),
        CHITTYID_SERVICE_URL: 'https://id.chitty.cc',
        CHITTY_ID_TOKEN: 'test-token',
      });

      const id = await resolver.mintChittyId({
        projectPath: '/test/project',
        workspace: 'test',
        supportType: 'development',
        organization: 'CHITTYOS',
      });

      // ChittyID format: VV-G-LLL-SSSS-T-YYMM-C-X where T is entity type
      const parts = id.split('-');
      expect(parts[4]).toBe('P'); // Type position must be P

      vi.unstubAllGlobals();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/nb/Desktop/Projects/github.com/CHITTYOS/chittyconnect && npx vitest run src/intelligence/__tests__/context-resolver.test.js`

Expected: FAIL — `entity_type` is `'CONTEXT'` not `'P'`, and fallback type is `'T'` not `'P'`

**Step 3: Fix entity_type in mintChittyId**

In `src/intelligence/context-resolver.js`, line 261:

```diff
-          entity_type: 'CONTEXT',
+          entity_type: 'P',
+          characterization: 'Synthetic',
```

**Step 4: Fix fallback type**

In `src/intelligence/context-resolver.js`, line 285:

```diff
-    const type = 'T';
+    const type = 'P';
```

**Step 5: Run test to verify it passes**

Run: `cd /Users/nb/Desktop/Projects/github.com/CHITTYOS/chittyconnect && npx vitest run src/intelligence/__tests__/context-resolver.test.js`

Expected: PASS

**Step 6: Commit**

```bash
git add src/intelligence/context-resolver.js src/intelligence/__tests__/context-resolver.test.js
git commit -m "fix: use Person (P) entity type for context minting

Context entities are synthetic Persons with agency, not Things.
Fixes Cardinal audit: entity_type 'CONTEXT' → 'P', fallback 'T' → 'P'."
```

---

### Task 2: Fix entity_type in experience-anchor.js

**Files:**
- Modify: `src/intelligence/experience-anchor.js:197-198, 227-237`
- Test: `src/intelligence/__tests__/experience-anchor.test.js` (create)

**Step 1: Write the failing test**

Create `src/intelligence/__tests__/experience-anchor.test.js`:

```javascript
import { describe, it, expect, vi } from 'vitest';

describe('ExperienceAnchor', () => {
  describe('mintContextIdentity', () => {
    it('should use entity_type P when calling ChittyID service', async () => {
      let capturedBody;
      const mockFetch = vi.fn().mockImplementation(async (url, opts) => {
        capturedBody = JSON.parse(opts.body);
        return {
          ok: true,
          json: async () => ({ chitty_id: '03-1-USA-5678-P-2602-0-02' }),
        };
      });
      vi.stubGlobal('fetch', mockFetch);

      const { ExperienceAnchor } = await import('../experience-anchor.js');
      const anchor = new ExperienceAnchor({
        DB: { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first: vi.fn(), run: vi.fn() })) })) },
        CHITTYID_SERVICE_URL: 'https://id.chitty.cc',
        CHITTY_ID_SERVICE_TOKEN: 'test-token',
      });

      await anchor.mintContextIdentity({ platform: 'claude_code' });

      expect(capturedBody.entity_type).toBe('P');
      expect(capturedBody.entity_type).not.toBe('context_identity');

      vi.unstubAllGlobals();
    });
  });

  describe('generateLocalChittyId', () => {
    it('should use P in the entity type position of the generated ID', async () => {
      const { ExperienceAnchor } = await import('../experience-anchor.js');
      const anchor = new ExperienceAnchor({
        DB: { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first: vi.fn(), run: vi.fn() })) })) },
      });

      const id = anchor.generateLocalChittyId({ platform: 'claude_code' });

      // The type position (5th segment) must be P
      // Current format: AA-C-CTX-SSSS-I-YYMM-T-X
      // Required format: type position must contain 'P'
      expect(id).toMatch(/P/);
      expect(id).not.toMatch(/-I-/);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/intelligence/__tests__/experience-anchor.test.js`

Expected: FAIL — `entity_type` is `"context_identity"` and fallback has `I` not `P`

**Step 3: Fix mintContextIdentity**

In `src/intelligence/experience-anchor.js`, line 197-198:

```diff
-          entity_type: "context_identity",
-          classification: "internal",
+          entity_type: "P",
+          characterization: "Synthetic",
+          classification: "internal",
```

**Step 4: Fix generateLocalChittyId**

In `src/intelligence/experience-anchor.js`, lines 227-237:

```diff
   generateLocalChittyId(context) {
     const timestamp = Date.now().toString(36);
     const random = Math.random().toString(36).substring(2, 8);
     const _platform = (context.platform || "UNK").substring(0, 3).toUpperCase();

-    // Format: AA-C-CTX-SSSS-I-YYMM-T-X (simplified)
+    // Format: VV-G-LLL-SSSS-P-YYMM-C-X (canonical ChittyID format)
     const now = new Date();
     const yearMonth = `${now.getFullYear() % 100}${(now.getMonth() + 1).toString().padStart(2, "0")}`;
     const sequence = timestamp.substring(0, 4).toUpperCase();

-    return `AA-C-CTX-${sequence}-I-${yearMonth}-3-${random.substring(0, 1).toUpperCase()}`;
+    return `03-1-USA-${sequence}-P-${yearMonth}-0-${random.substring(0, 1).toUpperCase()}`;
   }
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run src/intelligence/__tests__/experience-anchor.test.js`

Expected: PASS

**Step 6: Commit**

```bash
git add src/intelligence/experience-anchor.js src/intelligence/__tests__/experience-anchor.test.js
git commit -m "fix: use Person (P) entity type in ExperienceAnchor

Fixes entity_type 'context_identity' → 'P' in mintContextIdentity.
Fixes fallback ID format to canonical VV-G-LLL-SSSS-P-YYMM-C-X."
```

---

### Task 3: Fix lifecycle entity types in context-intelligence.js

**Files:**
- Modify: `src/intelligence/context-intelligence.js:22-27, 125, 139, 407, 491, 532, 604`

**Step 1: Write the failing test**

Create `src/intelligence/__tests__/context-intelligence.test.js`:

```javascript
import { describe, it, expect, vi } from 'vitest';

function createMockDb(rows = {}) {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn().mockResolvedValue(rows.first || null),
        all: vi.fn().mockResolvedValue({ results: rows.all || [] }),
        run: vi.fn().mockResolvedValue({ success: true }),
      })),
    })),
  };
}

describe('ContextIntelligence', () => {
  describe('loadContextProfile', () => {
    it('should not include preferences in the returned profile', async () => {
      const mockRow = {
        id: 1,
        chitty_id: '03-1-USA-1234-P-2602-0-01',
        patterns: '["pattern1"]',
        traits: '["trait1"]',
        preferences: '["pref1"]', // should be stripped
        competencies: '["comp1"]',
        expertise_domains: '["domain1"]',
        total_interactions: 100,
        total_decisions: 10,
        success_rate: 0.85,
        anomaly_count: 0,
        last_anomaly_at: null,
      };

      const { ContextIntelligence } = await import('../context-intelligence.js');
      const intel = new ContextIntelligence({
        DB: createMockDb({ first: mockRow }),
      });

      const profile = await intel.loadContextProfile('03-1-USA-1234-P-2602-0-01');

      expect(profile).not.toHaveProperty('preferences');
      expect(profile.patterns).toEqual(['pattern1']);
      expect(profile.traits).toEqual(['trait1']);
      expect(profile.competencies).toEqual(['comp1']);
    });
  });

  describe('lifecycle operations', () => {
    it('should use entity_type P for supernova merge minting', async () => {
      // This test verifies the JSDoc and call sites use 'P' not 'S/F/D/X'
      let capturedBody;
      const mockFetch = vi.fn().mockImplementation(async (url, opts) => {
        if (opts?.body) capturedBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ chitty_id: '03-1-USA-9999-P-2602-0-01' }) };
      });
      vi.stubGlobal('fetch', mockFetch);

      const { ContextIntelligence } = await import('../context-intelligence.js');
      const intel = new ContextIntelligence({
        DB: createMockDb({
          first: {
            id: 1, chitty_id: '03-1-USA-1111-P-2602-0-01',
            patterns: '[]', traits: '[]', competencies: '[]',
            expertise_domains: '[]', total_interactions: 10,
            status: 'active', current_sessions: '[]',
          },
        }),
      });

      // If supernova/fission methods exist and call mintChittyId,
      // verify the entity_type parameter is 'P'
      if (typeof intel.executeSupernova === 'function') {
        try {
          await intel.executeSupernova({
            sourceContextIds: ['03-1-USA-1111-P-2602-0-01'],
          });
        } catch (e) { /* may fail on other validation */ }

        if (capturedBody) {
          expect(capturedBody.entity_type).toBe('P');
        }
      }

      vi.unstubAllGlobals();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/intelligence/__tests__/context-intelligence.test.js`

Expected: FAIL — `preferences` field is included in profile

**Step 3: Update JSDoc for mintChittyId parameter**

In `src/intelligence/context-intelligence.js`, lines 22-27:

```diff
  * Mint a ChittyID via the canonical ChittyID service
  * Falls back to validated local generation only if service is unavailable
  *
  * @param {Object} env - Worker environment with service URLs
- * @param {string} entityType - Type code: T=standard, S=supernova, F=fission, D=derivative, X=suspension
+ * @param {string} entityType - Canonical type code: P (Person). Lifecycle provenance (supernova, fission, derivative, suspension) is metadata, not entity type.
  * @param {Object} metadata - Additional minting metadata
+ * @canonical-uri chittycanon://core/services/chittyconnect/intelligence/context-intelligence
```

**Step 4: Remove preferences from loadContextProfile query**

In `src/intelligence/context-intelligence.js`, line 125:

```diff
-      SELECT ce.*, cd.patterns, cd.traits, cd.preferences, cd.competencies,
+      SELECT ce.*, cd.patterns, cd.traits, cd.competencies,
```

Line 139 — remove preferences parsing:

```diff
       patterns: JSON.parse(result.patterns || '[]'),
       traits: JSON.parse(result.traits || '[]'),
-      preferences: JSON.parse(result.preferences || '[]'),
       competencies: JSON.parse(result.competencies || '[]'),
```

**Step 5: Fix lifecycle mint calls to use 'P' with metadata**

Lines 407, 491, 532, 604 — change entity type from S/F/D/X to P with lifecycle metadata:

```diff
- const mergedChittyId = await mintChittyId(this.env, 'S', { ... });
+ const mergedChittyId = await mintChittyId(this.env, 'P', { lifecycle: 'supernova', ...rest });

- const newChittyId = await mintChittyId(this.env, 'F', { ... });
+ const newChittyId = await mintChittyId(this.env, 'P', { lifecycle: 'fission', ...rest });

- const derivativeChittyId = await mintChittyId(this.env, 'D', { ... });
+ const derivativeChittyId = await mintChittyId(this.env, 'P', { lifecycle: 'derivative', ...rest });

- const suspensionChittyId = await mintChittyId(this.env, 'X', { ... });
+ const suspensionChittyId = await mintChittyId(this.env, 'P', { lifecycle: 'suspension', ...rest });
```

**Step 6: Run test to verify it passes**

Run: `npx vitest run src/intelligence/__tests__/context-intelligence.test.js`

Expected: PASS

**Step 7: Commit**

```bash
git add src/intelligence/context-intelligence.js src/intelligence/__tests__/context-intelligence.test.js
git commit -m "fix: canonical entity types in ContextIntelligence

Remove preferences from context DNA queries.
Fix lifecycle operations to use P with lifecycle metadata instead of S/F/D/X.
Update JSDoc to reference canonical governance."
```

---

### Task 4: Add canonical URI annotations to memory-cloude.js and experience-anchor.js

**Files:**
- Modify: `src/intelligence/memory-cloude.js:1-8`
- Modify: `src/intelligence/experience-anchor.js:1-10` (check existing JSDoc)

**Step 1: Add @canonical-uri to memory-cloude.js**

In `src/intelligence/memory-cloude.js`, update the module JSDoc:

```diff
 /**
  * MemoryCloude™ - Perpetual Context System
  *
  * Provides 90-day semantic memory with vector storage, cross-session learning,
  * and intelligent context recall for ChittyConnect.
  *
  * @module intelligence/memory-cloude
+ * @canonical-uri chittycanon://core/services/chittyconnect/intelligence/memory-cloude
+ * @canon chittycanon://gov/governance#core-types
  */
```

**Step 2: Add @canonical-uri to experience-anchor.js**

Add to the top of `src/intelligence/experience-anchor.js`:

```diff
+/**
+ * ExperienceAnchor - Experience Provenance Tracking
+ *
+ * Manages context identity minting, experience accumulation, and
+ * provenance chains for synthetic Person (P) entities.
+ *
+ * @module intelligence/experience-anchor
+ * @canonical-uri chittycanon://core/services/chittyconnect/intelligence/experience-anchor
+ * @canon chittycanon://gov/governance#core-types
+ */
```

**Step 3: Commit**

```bash
git add src/intelligence/memory-cloude.js src/intelligence/experience-anchor.js
git commit -m "docs: add canonical URI annotations to intelligence modules"
```

---

### Task 5: Add frontmatter to architecture docs

**Files:**
- Modify: `development/docs/architecture/CONTEXT_ANCHOR_MODEL.md` (add YAML frontmatter)
- Modify: `development/docs/architecture/EXPERIENCE_PROVENANCE_SCHEMA.md` (add YAML frontmatter)

**Step 1: Add frontmatter to CONTEXT_ANCHOR_MODEL.md**

Prepend to `development/docs/architecture/CONTEXT_ANCHOR_MODEL.md`:

```yaml
---
uri: chittycanon://docs/tech/architecture/context-anchor-model
namespace: chittycanon://docs/tech
type: architecture
version: 1.0.0
status: DRAFT
registered_with: chittycanon://core/services/canon
title: "Context Anchor Model"
author: "ChittyOS Foundation"
created: 2026-02-09T00:00:00Z
modified: 2026-02-23T00:00:00Z
visibility: INTERNAL
tags: [context, chittyid, identity, experience]
---
```

**Step 2: Add frontmatter to EXPERIENCE_PROVENANCE_SCHEMA.md**

Prepend to `development/docs/architecture/EXPERIENCE_PROVENANCE_SCHEMA.md`:

```yaml
---
uri: chittycanon://docs/tech/architecture/experience-provenance-schema
namespace: chittycanon://docs/tech
type: architecture
version: 1.0.0
status: DRAFT
registered_with: chittycanon://core/services/canon
title: "Experience Provenance Schema"
author: "ChittyOS Foundation"
created: 2026-02-09T00:00:00Z
modified: 2026-02-23T00:00:00Z
visibility: INTERNAL
tags: [experience, provenance, chittydna, ledger]
---
```

**Step 3: Commit**

```bash
git add development/docs/architecture/CONTEXT_ANCHOR_MODEL.md development/docs/architecture/EXPERIENCE_PROVENANCE_SCHEMA.md
git commit -m "docs: add canonical frontmatter to architecture docs"
```

---

### Task 6: Fix validation test schema

**Files:**
- Modify: `src/api/__tests__/validation.test.js`

**Step 1: Update entity enum in ChittyID mint validation**

Find the `ChittyIDMintSchema` definition that includes `'CONTEXT'` and update:

```diff
  entity: z.enum([
-   "PEO", "PLACE", "PROP", "EVNT", "AUTH", "INFO", "FACT",
-   "CONTEXT",
-   "ACTOR",
+   "P", "L", "T", "E", "A",
  ]),
```

**Step 2: Run full test suite**

Run: `npx vitest run`

Expected: All tests PASS

**Step 3: Commit**

```bash
git add src/api/__tests__/validation.test.js
git commit -m "fix: use canonical P/L/T/E/A entity types in validation schema"
```

---

## Phase 2: MCP Tool Registration

Add 5 new context tools and enhance 2 existing memory tools in the MCP tool dispatcher.

### Task 7: Add context_resolve tool to tool-dispatcher.js

**Files:**
- Modify: `src/mcp/tool-dispatcher.js`
- Test: `src/mcp/__tests__/tool-dispatcher-context.test.js` (create)

**Step 1: Write the failing test**

Create `src/mcp/__tests__/tool-dispatcher-context.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchToolCall } from '../tool-dispatcher.js';

describe('Context MCP Tools', () => {
  let mockEnv;

  beforeEach(() => {
    mockEnv = {
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            first: vi.fn().mockResolvedValue(null),
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn().mockResolvedValue({ success: true }),
          })),
        })),
      },
    };
  });

  describe('context_resolve', () => {
    it('should dispatch context_resolve and return a binding', async () => {
      const mockResponse = {
        chittyId: '03-1-USA-1234-P-2602-0-01',
        action: 'bind_existing',
        context: { id: 1, project_path: '/test' },
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockResponse,
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await dispatchToolCall(
        'context_resolve',
        { project_path: '/test/project', platform: 'claude_code', support_type: 'development' },
        mockEnv,
        { baseUrl: 'https://connect.chitty.cc', authToken: 'test' }
      );

      expect(result.content).toBeDefined();
      expect(result.content[0].type).toBe('text');
      expect(result.isError).toBeFalsy();

      vi.unstubAllGlobals();
    });
  });

  describe('context_commit', () => {
    it('should dispatch context_commit with session metrics', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, ledgerEntry: 'abc123' }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const result = await dispatchToolCall(
        'context_commit',
        {
          session_id: 'session-123',
          chitty_id: '03-1-USA-1234-P-2602-0-01',
          metrics: { interactions: 15, decisions: 2, success_rate: 0.9 },
        },
        mockEnv,
        { baseUrl: 'https://connect.chitty.cc', authToken: 'test' }
      );

      expect(result.content).toBeDefined();
      expect(result.isError).toBeFalsy();

      vi.unstubAllGlobals();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/mcp/__tests__/tool-dispatcher-context.test.js`

Expected: FAIL — `context_resolve` and `context_commit` not recognized as tools

**Step 3: Add context tools to tool-dispatcher.js**

Find the section in `src/mcp/tool-dispatcher.js` near the intelligence/memory tools (around line 471-487) and add the context tool family:

```javascript
    // ── Context tools ─────────────────────────────────────────────────
    else if (name === 'context_resolve') {
      const response = await fetch(`${baseUrl}/api/v1/intelligence/context/resolve`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_path: args.project_path,
          platform: args.platform || 'claude_code',
          support_type: args.support_type || 'development',
          organization: args.organization,
        }),
      });
      result = await response.json();
    }

    else if (name === 'context_restore') {
      const response = await fetch(
        `${baseUrl}/api/v1/intelligence/context/${encodeURIComponent(args.chitty_id)}/restore?project=${encodeURIComponent(args.project_slug || '')}`,
        { headers: { ...authHeader } }
      );
      result = await response.json();
    }

    else if (name === 'context_commit') {
      const response = await fetch(`${baseUrl}/api/v1/intelligence/context/commit`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: args.session_id,
          chitty_id: args.chitty_id,
          project_slug: args.project_slug,
          metrics: args.metrics,
          decisions: args.decisions,
        }),
      });
      result = await response.json();
    }

    else if (name === 'context_check') {
      const response = await fetch(
        `${baseUrl}/api/v1/intelligence/context/${encodeURIComponent(args.chitty_id)}/check`,
        { headers: { ...authHeader } }
      );
      result = await response.json();
    }

    else if (name === 'context_checkpoint') {
      const response = await fetch(`${baseUrl}/api/v1/intelligence/context/checkpoint`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chitty_id: args.chitty_id,
          project_slug: args.project_slug,
          name: args.name,
          state: args.state,
        }),
      });
      result = await response.json();
    }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/mcp/__tests__/tool-dispatcher-context.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add src/mcp/tool-dispatcher.js src/mcp/__tests__/tool-dispatcher-context.test.js
git commit -m "feat: add context MCP tools (resolve, restore, commit, check, checkpoint)

Five new tools for the context lifecycle:
- context_resolve: bind session to ChittyID
- context_restore: load full context state for a project
- context_commit: commit session experience metrics
- context_check: get current trust/DNA/experience summary
- context_checkpoint: create named checkpoint"
```

---

### Task 8: Enhance memory tools with chitty_id parameter

**Files:**
- Modify: `src/mcp/tool-dispatcher.js` (memory section, around lines 481-487)

**Step 1: Add test for enhanced memory tools**

Append to `src/mcp/__tests__/tool-dispatcher-context.test.js`:

```javascript
  describe('memory_persist (enhanced)', () => {
    it('should pass chitty_id when provided', async () => {
      let capturedUrl;
      const mockFetch = vi.fn().mockImplementation(async (url) => {
        capturedUrl = url;
        return { ok: true, json: async () => ({ stored: true }) };
      });
      vi.stubGlobal('fetch', mockFetch);

      await dispatchToolCall(
        'memory_persist',
        { content: 'test memory', chitty_id: '03-1-USA-1234-P-2602-0-01' },
        mockEnv,
        { baseUrl: 'https://connect.chitty.cc', authToken: 'test' }
      );

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.chitty_id).toBe('03-1-USA-1234-P-2602-0-01');

      vi.unstubAllGlobals();
    });
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/mcp/__tests__/tool-dispatcher-context.test.js`

Expected: FAIL — memory tools don't pass chitty_id

**Step 3: Enhance memory tool dispatchers**

In `src/mcp/tool-dispatcher.js`, find the memory prefix handler (around lines 481-487) and update:

```javascript
    // ── Memory tools (enhanced with chitty_id) ──────────────────────
    else if (name === 'memory_persist') {
      const response = await fetch(`${baseUrl}/api/v1/memory/persist`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: args.content,
          chitty_id: args.chitty_id,
          session_id: args.session_id,
          tags: args.tags,
        }),
      });
      result = await response.json();
    }

    else if (name === 'memory_recall') {
      const params = new URLSearchParams();
      if (args.query) params.set('query', args.query);
      if (args.chitty_id) params.set('chitty_id', args.chitty_id);
      if (args.limit) params.set('limit', args.limit);

      const response = await fetch(
        `${baseUrl}/api/v1/memory/recall?${params}`,
        { headers: { ...authHeader } }
      );
      result = await response.json();
    }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/mcp/__tests__/tool-dispatcher-context.test.js`

Expected: PASS

**Step 5: Commit**

```bash
git add src/mcp/tool-dispatcher.js src/mcp/__tests__/tool-dispatcher-context.test.js
git commit -m "feat: enhance memory MCP tools with chitty_id parameter

memory_persist and memory_recall now accept chitty_id for
identity-bound storage and cross-session recall."
```

---

### Task 9: Add backend API routes for context tools

**Files:**
- Modify: `src/index.ts` or `src/routes/` (add route handlers that call ContextResolver)

**Step 1: Identify route file**

Check where intelligence routes are defined. Look for the file that handles `/api/v1/intelligence/` routes.

Run: `grep -rn 'intelligence' src/routes/ src/index.ts --include='*.{js,ts}' | head -20`

**Step 2: Add context routes**

Add these route handlers to the intelligence router (or create `src/routes/context.js` if routes are modular):

```javascript
// POST /api/v1/intelligence/context/resolve
router.post('/intelligence/context/resolve', async (c) => {
  const { project_path, platform, support_type, organization } = await c.req.json();
  const resolver = new ContextResolver(c.env);
  const result = await resolver.resolveContext({
    projectPath: project_path,
    platform,
    supportType: support_type,
    organization,
  });
  return c.json(result);
});

// GET /api/v1/intelligence/context/:chittyId/restore
router.get('/intelligence/context/:chittyId/restore', async (c) => {
  const chittyId = c.req.param('chittyId');
  const project = c.req.query('project');
  const resolver = new ContextResolver(c.env);
  const context = await resolver.resolveContext({ explicitChittyId: chittyId });
  // Load DNA and last state
  const intel = new ContextIntelligence(c.env);
  const profile = await intel.loadContextProfile(chittyId);
  return c.json({ context: context?.context, profile, project });
});

// POST /api/v1/intelligence/context/commit
router.post('/intelligence/context/commit', async (c) => {
  const { session_id, chitty_id, project_slug, metrics, decisions } = await c.req.json();
  const resolver = new ContextResolver(c.env);
  const result = await resolver.unbindSession(session_id, {
    interactions: metrics?.interactions || 0,
    decisions: metrics?.decisions || 0,
    successRate: metrics?.success_rate || 0,
    competencies: metrics?.competencies || [],
    domains: metrics?.domains || [],
  });
  return c.json(result);
});

// GET /api/v1/intelligence/context/:chittyId/check
router.get('/intelligence/context/:chittyId/check', async (c) => {
  const chittyId = c.req.param('chittyId');
  const intel = new ContextIntelligence(c.env);
  const profile = await intel.loadContextProfile(chittyId);
  if (!profile) return c.json({ error: 'Context not found' }, 404);
  return c.json({
    chittyId,
    trustLevel: profile.trust_level,
    trustScore: profile.trust_score,
    totalSessions: profile.total_sessions,
    totalInteractions: profile.total_interactions,
    successRate: profile.success_rate,
    expertiseDomains: profile.expertise_domains,
    competencies: profile.competencies,
  });
});

// POST /api/v1/intelligence/context/checkpoint
router.post('/intelligence/context/checkpoint', async (c) => {
  const { chitty_id, project_slug, name, state } = await c.req.json();
  const resolver = new ContextResolver(c.env);
  // Store checkpoint as a ledger entry with type 'checkpoint'
  await resolver.appendLedger(chitty_id, {
    event_type: 'checkpoint',
    project_slug,
    name,
    state,
  });
  return c.json({ success: true, name, chittyId: chitty_id });
});
```

**Note:** Exact file path and import structure depends on how the router is organized — check `src/routes/` or `src/index.ts` for the pattern. Follow the existing route registration pattern.

**Step 3: Run tests**

Run: `npx vitest run`

Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/routes/ src/index.ts  # or whichever files were modified
git commit -m "feat: add context API routes for MCP tool backend

Routes: resolve, restore, commit, check, checkpoint
These back the 5 new context MCP tools added in the previous commit."
```

---

## Phase 3: Local Hooks + Cache

Create the session lifecycle hooks and upgrade the local state schema.

### Task 10: Create chittycontext-session-start.sh hook

**Files:**
- Create: `~/.claude/hooks/chittycontext-session-start.sh`

**Step 1: Write the hook script**

Create `~/.claude/hooks/chittycontext-session-start.sh`:

```bash
#!/usr/bin/env bash
# chittycontext-session-start.sh
# Auto-resolve context and load project state on session start.
# Registered as SessionStart hook in settings.json.

set -euo pipefail

CONTEXT_DIR="$HOME/.claude/chittycontext"
PROJECT_PATH="$(pwd)"
PROJECT_SLUG=$(basename "$PROJECT_PATH")
ORG=$(basename "$(dirname "$PROJECT_PATH")")
SESSION_ID="session-$(date +%s)-$$"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Ensure context directory exists
mkdir -p "$CONTEXT_DIR"

# 1. Drain sync queue if pending items exist
if [ -f "$CONTEXT_DIR/sync_queue.json" ]; then
  PENDING=$(python3 -c "
import json, sys
try:
    q = json.load(open('$CONTEXT_DIR/sync_queue.json'))
    print(len(q.get('pending', [])))
except: print(0)
" 2>/dev/null || echo "0")

  if [ "$PENDING" -gt 0 ] 2>/dev/null; then
    # Attempt to drain via can chitty (non-blocking, best-effort)
    can chitty context-drain 2>/dev/null || true
  fi
fi

# 2. Load cached ChittyID (never generate locally per ChittyID Charter)
CACHED_ID=""
if [ -f "$CONTEXT_DIR/session_binding.json" ]; then
  CACHED_ID=$(python3 -c "
import json
b = json.load(open('$CONTEXT_DIR/session_binding.json'))
print(b.get('chittyId', ''))
" 2>/dev/null || echo "")
fi

# 3. Write session binding with project context
python3 -c "
import json, os

binding = {
    'chittyId': '$CACHED_ID',
    'sessionId': '$SESSION_ID',
    'platform': 'claude_code',
    'projectPath': '$PROJECT_PATH',
    'projectSlug': '$PROJECT_SLUG',
    'organization': '$ORG',
    'supportType': 'development',
    'resolvedFrom': 'cache',
    'resolvedAt': '$TIMESTAMP',
    'status': 'active'
}

with open('$CONTEXT_DIR/session_binding.json', 'w') as f:
    json.dump(binding, f, indent=2)
" 2>/dev/null

# 4. Load project state summary for Claude's context
ENTITY_DIR="$CONTEXT_DIR/entities"
STATE_FILE=""
if [ -d "$ENTITY_DIR" ] && [ -n "$CACHED_ID" ]; then
  STATE_FILE=$(find "$ENTITY_DIR" -path "*/$PROJECT_SLUG/current_state.json" 2>/dev/null | head -1)
fi

if [ -n "$STATE_FILE" ] && [ -f "$STATE_FILE" ]; then
  SUMMARY=$(python3 -c "
import json
s = json.load(open('$STATE_FILE'))
ctx = s.get('context', {})
print(ctx.get('summary', 'No context summary available'))
" 2>/dev/null || echo "State file unreadable")
  echo "[ChittyContext] Project: $PROJECT_SLUG | $SUMMARY"
else
  echo "[ChittyContext] Project: $PROJECT_SLUG | New session (no prior state)"
fi
```

**Step 2: Make it executable**

Run: `chmod +x ~/.claude/hooks/chittycontext-session-start.sh`

**Step 3: Test it manually**

Run: `cd /Users/nb/Desktop/Projects/github.com/CHITTYOS/chittyconnect && bash ~/.claude/hooks/chittycontext-session-start.sh`

Expected: Output like `[ChittyContext] Project: chittyconnect | <summary or "New session">`

**Step 4: Commit hook to dotfiles (if tracked)**

```bash
# If ~/.claude is tracked in a dotfiles repo:
cd ~/.claude && git add hooks/chittycontext-session-start.sh
git commit -m "feat: add ChittyContext session start hook"
```

---

### Task 11: Create chittycontext-session-end.sh hook

**Files:**
- Create: `~/.claude/hooks/chittycontext-session-end.sh`

**Step 1: Write the hook script**

Create `~/.claude/hooks/chittycontext-session-end.sh`:

```bash
#!/usr/bin/env bash
# chittycontext-session-end.sh
# Commit session experience and update local cache on session end.
# Registered as Stop hook in settings.json.

set -euo pipefail

CONTEXT_DIR="$HOME/.claude/chittycontext"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# 1. Read current session binding
if [ ! -f "$CONTEXT_DIR/session_binding.json" ]; then
  exit 0
fi

SESSION_DATA=$(cat "$CONTEXT_DIR/session_binding.json")
PROJECT_SLUG=$(echo "$SESSION_DATA" | python3 -c "import json,sys; print(json.load(sys.stdin).get('projectSlug',''))" 2>/dev/null || echo "")
SESSION_ID=$(echo "$SESSION_DATA" | python3 -c "import json,sys; print(json.load(sys.stdin).get('sessionId',''))" 2>/dev/null || echo "")
CHITTY_ID=$(echo "$SESSION_DATA" | python3 -c "import json,sys; print(json.load(sys.stdin).get('chittyId',''))" 2>/dev/null || echo "")

if [ -z "$PROJECT_SLUG" ]; then
  exit 0
fi

# 2. Queue session commit for MCP drain on next start
# (Stop hooks should be fast — don't block on network calls)
python3 -c "
import json, os

queue_path = '$CONTEXT_DIR/sync_queue.json'

# Load or create queue
if os.path.exists(queue_path):
    with open(queue_path) as f:
        queue = json.load(f)
else:
    queue = {'pending': []}

# Add session commit entry
queue['pending'].append({
    'type': 'context_commit',
    'timestamp': '$TIMESTAMP',
    'sessionId': '$SESSION_ID',
    'chittyId': '$CHITTY_ID',
    'projectSlug': '$PROJECT_SLUG',
    'payload': {
        'interactions': 0,
        'decisions': 0,
        'success_rate': 0
    }
})

with open(queue_path, 'w') as f:
    json.dump(queue, f, indent=2)
" 2>/dev/null

# 3. Update session binding status
python3 -c "
import json

path = '$CONTEXT_DIR/session_binding.json'
with open(path) as f:
    b = json.load(f)

b['status'] = 'ended'
b['endedAt'] = '$TIMESTAMP'

with open(path, 'w') as f:
    json.dump(b, f, indent=2)
" 2>/dev/null
```

**Step 2: Make it executable**

Run: `chmod +x ~/.claude/hooks/chittycontext-session-end.sh`

**Step 3: Test it manually**

Run: `bash ~/.claude/hooks/chittycontext-session-end.sh`

Expected: session_binding.json gets `status: "ended"`, sync_queue.json gains an entry

**Step 4: Commit**

```bash
cd ~/.claude && git add hooks/chittycontext-session-end.sh
git commit -m "feat: add ChittyContext session end hook"
```

---

### Task 12: Register hooks in settings.json

**Files:**
- Modify: `~/.claude/settings.json`

**Step 1: Read current settings.json to understand existing hooks**

Read `~/.claude/settings.json` and locate the `hooks` section.

**Step 2: Add hooks**

Add the ChittyContext hooks to the existing SessionStart and Stop arrays:

In the `SessionStart` array, append:
```json
{
  "type": "command",
  "command": "$HOME/.claude/hooks/chittycontext-session-start.sh"
}
```

In the `Stop` array, append:
```json
{
  "type": "command",
  "command": "$HOME/.claude/hooks/chittycontext-session-end.sh"
}
```

**Step 3: Verify settings.json is valid JSON**

Run: `python3 -m json.tool ~/.claude/settings.json > /dev/null`

Expected: No error

**Step 4: Commit**

```bash
cd ~/.claude && git add settings.json
git commit -m "feat: register ChittyContext hooks in settings.json"
```

---

### Task 13: Initialize sync_queue.json and upgrade local state schema

**Files:**
- Create: `~/.claude/chittycontext/sync_queue.json` (if not exists)
- Modify: `~/.claude/chittycontext/manifest.json` (add schemaVersion field)

**Step 1: Create sync_queue.json**

```json
{
  "pending": []
}
```

**Step 2: Add experience_accumulator.json to the entity directory**

For the existing entity (`03-1-USA-7165-T-2602-0-13`), create:

`~/.claude/chittycontext/entities/03-1-USA-7165-T-2602-0-13/experience_accumulator.json`:

```json
{
  "chittyId": "03-1-USA-7165-T-2602-0-13",
  "totalSessions": 85,
  "totalInteractions": 1312,
  "totalDecisions": 94,
  "successRate": 0.83,
  "expertiseDomains": [
    { "domain": "cloudflare-workers", "level": "proficient", "sessions": 45 },
    { "domain": "legal-evidence", "level": "competent", "sessions": 12 },
    { "domain": "infrastructure", "level": "proficient", "sessions": 20 },
    { "domain": "typescript", "level": "proficient", "sessions": 40 },
    { "domain": "mcp-servers", "level": "competent", "sessions": 15 }
  ],
  "lastUpdated": "2026-02-23T00:00:00Z",
  "syncedFromBackend": false
}
```

**Step 3: Commit**

```bash
cd ~/.claude && git add chittycontext/sync_queue.json chittycontext/entities/*/experience_accumulator.json
git commit -m "feat: add sync queue and experience accumulator to local state"
```

---

### Task 14: Rewrite ChittyContext skill

**Files:**
- Modify: `~/.claude/skills/chittycontext/SKILL.md`

**Step 1: Read the existing skill**

Read `~/.claude/skills/chittycontext/SKILL.md` to understand the current content.

**Step 2: Rewrite the skill**

Replace with v2.0 that:
- Removes Desktop Commander references
- Adds MCP-backed commands (resolve, commit, drain, check)
- Keeps offline commands (checkpoint, restore, status)
- Adds `experience` command for DNA/trust display
- Auto-triggers on session start (load) and end (save)
- References correct file paths and schemas

The skill should document:
- Commands table with 8 commands
- Auto-behaviors: read session_binding on start, update state during work, queue commit on end
- Schema references: session_binding.json, current_state.json, experience_accumulator.json, sync_queue.json
- Offline fallback behavior
- Entity path resolution: `~/.claude/chittycontext/entities/{chittyId}/{project-slug}/`

**Step 3: Commit**

```bash
cd ~/.claude && git add skills/chittycontext/SKILL.md
git commit -m "feat: rewrite ChittyContext skill for v2.0 (MCP + hooks integration)"
```

---

## Phase 4: ChittyID Re-mint + Migration

Re-mint existing T-typed ChittyIDs as P-typed via the ChittyID service.

### Task 15: Re-mint ChittyIDs with correct entity type

**Files:**
- Modify: `~/.claude/chittycontext/manifest.json`
- Modify: `~/.claude/chittycontext/session_binding.json`
- Modify: `~/.claude/chittycontext/entities/03-1-USA-7165-T-2602-0-13/identity.json`
- Rename: `~/.claude/chittycontext/entities/03-1-USA-7165-T-...` → `entities/{new-P-id}`

**Step 1: Mint new P-typed ChittyID**

Call the ChittyID service (requires network and auth):

```bash
curl -X POST https://id.chitty.cc/api/v1/mint \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $(op read 'op://ChittyOS/ChittyID Service Token/credential')" \
  -d '{
    "entity_type": "P",
    "characterization": "Synthetic",
    "metadata": {
      "supersedes": "03-1-USA-7165-T-2602-0-13",
      "platform": "claude_code",
      "reason": "re-mint T→P per canonical governance"
    }
  }'
```

Record the new ChittyID from the response.

**Step 2: Rename entity directory**

```bash
OLD_ID="03-1-USA-7165-T-2602-0-13"
NEW_ID="<new-P-id-from-response>"
mv ~/.claude/chittycontext/entities/$OLD_ID ~/.claude/chittycontext/entities/$NEW_ID
```

**Step 3: Update identity.json**

Update `~/.claude/chittycontext/entities/{NEW_ID}/identity.json`:
- `chittyId` → new ID
- `entityType` → `"P"`
- `canonicalType` → `"P"`
- Remove correction note
- Add `supersedes` field with old ID
- Update `migratedAt` timestamp

**Step 4: Update manifest.json**

- Replace old ID key with new ID key in `entities` map
- Update `entityType` to `"P"`
- Add migration log entry

**Step 5: Update session_binding.json**

- Replace `chittyId` with new ID

**Step 6: Repeat for second ID if it exists**

Check if `03-1-USA-2709-T-2602-0-42` also has a local entity directory and apply the same migration.

**Step 7: Commit**

```bash
cd ~/.claude && git add chittycontext/
git commit -m "fix: re-mint ChittyIDs from T (Thing) to P (Person)

Supersedes 03-1-USA-7165-T-2602-0-13 with new P-typed ChittyID.
Context entities are synthetic Persons with agency, not Things."
```

---

## Phase 5: Charter + Doc Governance

### Task 16: Add canonical frontmatter to charters missing it

**Files:**
- Modify: 5 CHARTER.md files across repos (ChittyID, ChittyConnect, ChittyRouter, ChittyEvidence, ChittyContextual)

**Step 1: Add frontmatter to each charter**

Each charter gets a YAML frontmatter block following this template:

```yaml
---
uri: chittycanon://docs/ops/policy/{service}-charter
namespace: chittycanon://docs/ops
type: policy
version: 1.0.0
status: CERTIFIED
registered_with: chittycanon://core/services/canon
title: "{Service} Charter"
certifier: chittycanon://core/services/chittycert
visibility: PUBLIC
---
```

**Step 2: Verify each file is valid YAML + Markdown**

Run a quick check on each file to ensure the frontmatter is properly delimited.

**Step 3: Commit per-repo**

Each repo gets its own commit since they're separate git repos:

```bash
# ChittyID
cd /path/to/chittyid && git add CHARTER.md && git commit -m "docs: add canonical frontmatter to charter"

# ChittyConnect
cd /path/to/chittyconnect && git add CHARTER.md && git commit -m "docs: add canonical frontmatter to charter"

# etc.
```

---

### Task 17: Add ChittyContext capability section to ChittyConnect Charter

**Files:**
- Modify: `/Users/nb/Desktop/Projects/github.com/CHITTYOS/chittyconnect/CHARTER.md`

**Step 1: Read the current charter**

Read `CHARTER.md` and find the appropriate section for capabilities.

**Step 2: Add ChittyContext capability section**

After the existing scope/capabilities section, add:

```markdown
### ChittyContext (Edge Cache Capability)

ChittyContext is a local edge cache at `~/.claude/chittycontext/` that provides
offline-resilient session state for Claude Code sessions. It is a **capability of
ChittyConnect**, not a standalone service.

**Responsibilities:**
- Auto-resolve session context via MCP bridge on session start
- Cache last-known state locally for offline resilience
- Queue session metrics for async commit to ChittyConnect backend
- Maintain project-scoped state files per entity

**Not a standalone service:** ChittyContext has no charter, no deployment, no health
endpoint. It is a client-side cache governed by ChittyConnect's ContextConsciousness™.
```

**Step 3: Commit**

```bash
cd /Users/nb/Desktop/Projects/github.com/CHITTYOS/chittyconnect
git add CHARTER.md
git commit -m "docs: add ChittyContext capability section to charter"
```

---

### Task 18: Write chittymac CHARTER.md

**Files:**
- Create: `/Users/nb/Desktop/Projects/github.com/CHITTYOS/chittymac/CHARTER.md`

**Step 1: Write the charter**

Based on the CLAUDE.md already in chittymac, create a charter:

```markdown
---
uri: chittycanon://docs/ops/policy/chittymac-charter
namespace: chittycanon://docs/ops
type: policy
version: 1.0.0
status: DRAFT
registered_with: chittycanon://core/services/canon
title: "ChittyMac Charter"
certifier: chittycanon://core/services/chittycert
visibility: PUBLIC
---

# ChittyMac Charter

## Classification
- **Canonical URI**: `chittycanon://core/services/chittymac`
- **Tier**: 3 (Service Layer)
- **Organization**: CHITTYOS
- **Domain**: N/A (local MCP server)

## Mission

ChittyMac is a unified Apple-native MCP server that syncs iMessage, Apple Notes,
and Reminders to Neon PostgreSQL, providing Claude with query access to local
Apple data sources.

## Scope

### IS Responsible For
- Syncing iMessage history to Neon (`imsg.*` schema)
- Syncing Apple Notes to Neon (`notes.*` schema)
- Syncing Reminders to Neon (`remind.*` schema)
- MCP server with 19 tools and 7 resources for querying synced data
- Sync watermark tracking (`sync.*` schema)

### IS NOT Responsible For
- Modifying local Apple data (read-only sync)
- Identity management (ChittyID)
- Authentication (ChittyAuth)
- Service registration (ChittyRegister)

## Dependencies

| Type | Service | Purpose |
|------|---------|---------|
| Storage | Neon PostgreSQL | ChittyLedger-Messaging project |
| Credential | 1Password | Database URL injection |

## Ownership

| Role | Owner |
|------|-------|
| Service Owner | ChittyOS |

## Compliance

- [ ] Service registered in ChittyRegistry
- [x] CLAUDE.md development guide present
- [x] CHARTER.md present
```

**Step 2: Commit**

```bash
cd /Users/nb/Desktop/Projects/github.com/CHITTYOS/chittymac
git add CHARTER.md
git commit -m "docs: add ChittyMac charter"
```

---

## Phase 6: Deploy + Activate

### Task 19: Deploy ChittyConnect to staging

**Step 1: Run full test suite**

Run: `cd /Users/nb/Desktop/Projects/github.com/CHITTYOS/chittyconnect && npx vitest run`

Expected: All tests PASS

**Step 2: Deploy to staging**

Run: `npm run deploy:staging`

Expected: Successful deployment to staging

**Step 3: Verify context routes**

```bash
# Health check
curl -s https://connect-staging.chitty.cc/health | jq .

# Verify context_check tool exists (will 401 without auth, but confirms route exists)
curl -s -o /dev/null -w '%{http_code}' https://connect-staging.chitty.cc/api/v1/intelligence/context/test/check
```

Expected: Health returns 200, context route returns 401 (auth required, not 404)

**Step 4: Commit any deploy-related changes**

If wrangler.toml or other config needed updates, commit them.

---

### Task 20: Deploy to production

**Step 1: Deploy**

Run: `npm run deploy:production`

**Step 2: Verify**

```bash
curl -s https://connect.chitty.cc/health | jq .
```

Expected: `{"status":"ok","service":"chittyconnect"}`

---

### Task 21: End-to-end test with a new Claude Code session

**Step 1: Start a new Claude Code session in a ChittyOS project directory**

The SessionStart hook should:
1. Read `session_binding.json`
2. Output `[ChittyContext] Project: <slug> | <summary>`

**Step 2: Verify session_binding.json was updated**

```bash
cat ~/.claude/chittycontext/session_binding.json | python3 -m json.tool
```

Expected: `status: "active"`, correct `projectSlug`, `sessionId`

**Step 3: End the session**

The Stop hook should:
1. Queue a `context_commit` to `sync_queue.json`
2. Set `session_binding.json` status to `"ended"`

**Step 4: Verify sync queue**

```bash
cat ~/.claude/chittycontext/sync_queue.json | python3 -m json.tool
```

Expected: One pending entry with type `context_commit`

---

## Summary

| Phase | Tasks | Focus |
|-------|-------|-------|
| 1 | 1-6 | Cardinal remediation — fix entity types to P |
| 2 | 7-9 | MCP tool registration — 5 new + 2 enhanced |
| 3 | 10-14 | Local hooks + cache — auto-save/restore |
| 4 | 15 | ChittyID re-mint — T→P migration |
| 5 | 16-18 | Charter + doc governance |
| 6 | 19-21 | Deploy + end-to-end verification |

Total: 21 tasks across 6 phases. Each task is a single committable unit.
