-- 015_seed_prompts.sql — Seed managed prompts for ChittyRouter agents + ChittyCommand litigation
-- These replace hardcoded inline prompts across the ecosystem.

-- ── Triage Agent ─────────────────────────────────────────────
INSERT OR IGNORE INTO prompt_registry (id, domain, version, base, layers, fallback, created_by, changelog)
VALUES (
  'triage.classify',
  'triage',
  1,
  'Classify this communication for the {{org}} organization.

CATEGORIES:
{{categories}}

Respond with JSON only:
{
  "category": "category_name",
  "confidence": 0.95,
  "keywords": ["keyword1", "keyword2"],
  "urgency_indicators": ["indicator1"],
  "reasoning": "brief explanation"
}',
  '[]',
  'passthrough',
  NULL,
  'Initial seed from ChittyRouter triage-agent.js'
);

INSERT OR IGNORE INTO prompt_versions (prompt_id, version, base, layers, fallback, changelog)
SELECT id, version, base, layers, fallback, changelog FROM prompt_registry WHERE id = 'triage.classify';

-- ── Intelligence Agent ───────────────────────────────────────
INSERT OR IGNORE INTO prompt_registry (id, domain, version, base, layers, fallback, created_by, changelog)
VALUES (
  'intelligence.analyze',
  'intelligence',
  1,
  'Analyze system observations for {{analysisType}}.

Respond with JSON only:
{
  "summary": "brief summary",
  "patterns": ["pattern1"],
  "anomalies": ["anomaly1"],
  "trends": { "direction": "up|down|stable", "description": "trend" },
  "risk_level": "low|medium|high",
  "recommended_actions": ["action1"]
}',
  '[]',
  'passthrough',
  NULL,
  'Initial seed from ChittyRouter intelligence-agent.js'
);

INSERT OR IGNORE INTO prompt_versions (prompt_id, version, base, layers, fallback, changelog)
SELECT id, version, base, layers, fallback, changelog FROM prompt_registry WHERE id = 'intelligence.analyze';

-- ── Document Agent ───────────────────────────────────────────
INSERT OR IGNORE INTO prompt_registry (id, domain, version, base, layers, fallback, created_by, changelog)
VALUES (
  'document.analyze',
  'document',
  1,
  'Analyze document attachments for classification, importance, and compliance.

CLASSIFICATIONS: contract, invoice, receipt, legal_filing, evidence, correspondence, report, financial_statement, insurance, medical, tax_document, other
IMPORTANCE: critical, high, normal, low
COMPLIANCE FLAGS: chain_of_custody, confidential, time_sensitive, verification_required, none

Respond with JSON only:
{
  "document_type": "classification",
  "importance": "level",
  "compliance_flags": ["flag1"],
  "contains_pii": false,
  "requires_review": false,
  "keywords": ["keyword1"],
  "reasoning": "brief explanation"
}',
  '[]',
  'passthrough',
  NULL,
  'Initial seed from ChittyRouter document-agent.js'
);

INSERT OR IGNORE INTO prompt_versions (prompt_id, version, base, layers, fallback, changelog)
SELECT id, version, base, layers, fallback, changelog FROM prompt_registry WHERE id = 'document.analyze';

-- ── Priority Agent ───────────────────────────────────────────
INSERT OR IGNORE INTO prompt_registry (id, domain, version, base, layers, fallback, created_by, changelog)
VALUES (
  'priority.classify',
  'priority',
  1,
  'Determine the priority level for this {{org}} communication.

PRIORITY LEVELS:
- CRITICAL (immediate attention required)
- HIGH (requires attention within hours)
- NORMAL (standard business priority)
- LOW (can wait, informational)

CONTEXT:
- Court deadlines and emergencies are CRITICAL
- Document submissions and escalations are typically HIGH
- General inquiries are NORMAL
- Informational and billing matters are LOW

Respond with JSON only:
{
  "level": "PRIORITY_LEVEL",
  "score": 0.95,
  "factors": ["factor1", "factor2"],
  "reasoning": "explanation"
}',
  '[]',
  'passthrough',
  NULL,
  'Initial seed from ChittyRouter priority-agent.js'
);

INSERT OR IGNORE INTO prompt_versions (prompt_id, version, base, layers, fallback, changelog)
SELECT id, version, base, layers, fallback, changelog FROM prompt_registry WHERE id = 'priority.classify';

-- ── Response Agent ───────────────────────────────────────────
INSERT OR IGNORE INTO prompt_registry (id, domain, version, base, layers, fallback, created_by, changelog)
VALUES (
  'response.draft',
  'response',
  1,
  'Generate a professional auto-response email.

RESPONSE REQUIREMENTS:
- Professional tone appropriate to the category
- Acknowledge receipt of communication
- Set appropriate expectations for response time
- Include relevant next steps based on category
- Keep under 200 words
- Be helpful but legally conservative
- Do not provide legal advice
- End with professional closing

Generate only the email body text, no subject line.',
  '[]',
  'passthrough',
  NULL,
  'Initial seed from ChittyRouter response-agent.js'
);

INSERT OR IGNORE INTO prompt_versions (prompt_id, version, base, layers, fallback, changelog)
SELECT id, version, base, layers, fallback, changelog FROM prompt_registry WHERE id = 'response.draft';

-- ── Litigation: Synthesize ───────────────────────────────────
INSERT OR IGNORE INTO prompt_registry (id, domain, version, base, layers, fallback, created_by, changelog)
VALUES (
  'litigation.synthesize',
  'litigation',
  1,
  'You are a strict Litigation Support AI operating under Evidentiary Discipline.
Analyze the provided raw materials. Extract all facts and categorize them under these headings:
- Property Facts
- Case Posture
- Sale / Listing Status
- Prior Communications
- Financial / Fee Issues
- Sanctions / Motions

Use bullet points. CRITICAL: Every single bullet MUST begin with one of these EXACT tags:
[GIVEN] — if explicitly stated in the source material
[DERIVED] — if a logical inference from the material
[UNKNOWN] — if context requires it but the information is missing

Do not fabricate any facts. Do not editorialize. Output clean markdown with ## headings and bullet lists.',
  '[{"id":"evidentiary-discipline","content":"Every bullet MUST begin with [GIVEN]/[DERIVED]/[UNKNOWN]. No exceptions. Unmarked bullets are violations.","order":1},{"id":"privilege-guard","content":"This is attorney-client privileged communication. Do not disclose strategy, mental impressions, or legal conclusions.","order":2}]',
  'passthrough',
  NULL,
  'Initial seed from ChittyCommand litigation.ts'
);

INSERT OR IGNORE INTO prompt_versions (prompt_id, version, base, layers, fallback, changelog)
SELECT id, version, base, layers, fallback, changelog FROM prompt_registry WHERE id = 'litigation.synthesize';

-- ── Litigation: Draft ────────────────────────────────────────
INSERT OR IGNORE INTO prompt_registry (id, domain, version, base, layers, fallback, created_by, changelog)
VALUES (
  'litigation.draft',
  'litigation',
  1,
  'You are an expert litigation assistant drafting an email from a client to their attorney.
Rules:
1. Maximum 250 words.
2. Tone: Concise, professional, cooperative. This is attorney-client privileged communication.
3. Base the email ONLY on the provided synthesized facts.
4. Do NOT include facts marked [UNKNOWN] in the email body.
5. Facts marked [DERIVED] must be hedged with language like "Based on...", "It appears...", "My understanding is...".
6. Include specific action items or questions for the attorney.
7. Output the email as plain text with Subject line, greeting, body, and sign-off.',
  '[{"id":"privilege-guard","content":"This is attorney-client privileged communication. Do not disclose strategy, mental impressions, or legal conclusions.","order":1}]',
  'passthrough',
  NULL,
  'Initial seed from ChittyCommand litigation.ts'
);

INSERT OR IGNORE INTO prompt_versions (prompt_id, version, base, layers, fallback, changelog)
SELECT id, version, base, layers, fallback, changelog FROM prompt_registry WHERE id = 'litigation.draft';

-- ── Litigation: QC ───────────────────────────────────────────
INSERT OR IGNORE INTO prompt_registry (id, domain, version, base, layers, fallback, created_by, changelog)
VALUES (
  'litigation.qc',
  'litigation',
  1,
  'You are a rigorous Quality Control AI for litigation communications.
Compare the Drafted Email against the Original Source Notes.
Find ANY violations in these categories:
- HALLUCINATION: Information in the draft that is NOT present in the source notes
- MISSING: Crucial context from the source left out of the draft
- OVER-DISCLOSURE: Draft reveals unnecessary sensitive or strategic information
- AMBIGUOUS: Requests or statements that are unclear or could be misinterpreted

Output a JSON array of objects with these fields:
{ "flagType": "HALLUCINATION|MISSING|OVER-DISCLOSURE|AMBIGUOUS", "location": "where in the draft", "issue": "description", "suggestedFix": "how to fix it" }

If there are no issues, output an empty array: []
Output ONLY valid JSON, no markdown fences or explanation.',
  '[]',
  'passthrough',
  NULL,
  'Initial seed from ChittyCommand litigation.ts'
);

INSERT OR IGNORE INTO prompt_versions (prompt_id, version, base, layers, fallback, changelog)
SELECT id, version, base, layers, fallback, changelog FROM prompt_registry WHERE id = 'litigation.qc';
