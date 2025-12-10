# ChittyEvidence v2.0 Quick Reference

## For ChittyConnect Users

### Evidence Lookup

```javascript
// ✅ NEW WAY (Recommended)
GET /api/chittyevidence/550e8400-e29b-41d4-a716-446655440000

// ⚠️ OLD WAY (Still works, deprecated)
GET /api/chittyevidence/abc123def456...sha256hash

// 🔄 LEGACY FORMAT (Transition period)
GET /api/chittyevidence/550e8400-...?legacy=true
```

### Field Name Changes

| Old (v1.0)           | New (v2.0)                  |
|----------------------|-----------------------------|
| `id` (integer)       | `evidence_id` (UUID)        |
| `exhibit_id`         | `evidence_number`           |
| `category`           | `document_type`             |
| `chitty_id`          | `case_id` (UUID)            |
| `tags`               | `ai_extracted_entities`     |
| `metadata`           | `custom_metadata`           |

### Response Structure

**v2.0 Format (Default):**
```json
{
  "evidence_id": "550e8400-e29b-41d4-a716-446655440000",
  "thing_id": "660f9500-f39c-52e5-b827-557766551111",
  "case_id": "770g0600-g40d-63f6-c938-668877662222",
  "evidence_number": "EX001",
  "evidence_tier": "L1",
  "document_type": "affidavit",
  "chain_of_custody_verified": true,
  "file_hash": "abc123...",
  "file_size": 12345,
  "mime_type": "application/pdf",
  "ai_extracted_entities": ["plaintiff", "defendant"],
  "created_at": "2024-11-15T10:00:00Z"
}
```

**v1.0 Legacy Format (`?legacy=true`):**
```json
{
  "id": 1426063360,
  "chitty_id": "arias_v_bianchi_2024D007847",
  "file_hash": "abc123...",
  "exhibit_id": "EX001",
  "category": "01_TRO_PROCEEDINGS",
  "tags": ["plaintiff", "defendant"],
  "metadata": {
    "file_size": 12345,
    "mime_type": "application/pdf",
    "evidence_tier": "L1",
    "thing_id": "660f9500-...",
    "evidence_id": "550e8400-..."
  },
  "_schema_version": "2.0_legacy_compat",
  "_use_evidence_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

### New Endpoints

```bash
# List evidence by case
GET /api/chittyevidence/case/{caseId}?limit=50&offset=0

# Get sync status
GET /api/chittyevidence/{evidenceId}/sync-status

# Trigger verification
POST /api/chittyevidence/{evidenceId}/verify
{
  "verificationType": "comprehensive"  # or "authenticity", "chain_of_custody"
}

# Health check
GET /api/chittyevidence/health
```

### MCP Tools

```javascript
// Ingest evidence (returns v2.0 UUIDs)
await mcp.call('chitty_evidence_ingest', {
  fileUrl: 'https://example.com/file.pdf',
  caseId: 'case-uuid',
  evidenceType: 'affidavit',
  metadata: { customField: 'value' }
});

// Get evidence (UUID or file_hash)
await mcp.call('chitty_evidence_get', {
  identifier: '550e8400-e29b-41d4-a716-446655440000',
  legacyFormat: false  // Set to true for v1.0 format
});

// List evidence by case
await mcp.call('chitty_evidence_list_by_case', {
  caseId: 'case-uuid',
  limit: 50,
  offset: 0
});

// Trigger verification
await mcp.call('chitty_evidence_verify', {
  evidenceId: '550e8400-e29b-41d4-a716-446655440000',
  verificationType: 'comprehensive'
});

// Get sync status
await mcp.call('chitty_evidence_sync_status', {
  evidenceId: '550e8400-e29b-41d4-a716-446655440000'
});
```

### Category Mapping

| v1.0 Category               | v2.0 Document Type    |
|-----------------------------|-----------------------|
| `00_KEY_EXHIBITS`           | `key_evidence`        |
| `01_TRO_PROCEEDINGS`        | `affidavit`           |
| `02_LLC_FORMATION`          | `contract`            |
| `03_MEMBERSHIP_REMOVAL`     | `legal_notice`        |
| `04_PREMARITAL_FUNDING`     | `financial_record`    |
| `05_PROPERTY_TRANSACTIONS`  | `deed`                |
| `06_FINANCIAL_STATEMENTS`   | `bank_statement`      |
| `07_COURT_FILINGS`          | `motion`              |
| `08_ATTORNEY_CORRESPONDENCE`| `correspondence`      |
| `09_PERJURY_EVIDENCE`       | `sworn_statement`     |
| `10_SANCTIONS_RULE137`      | `motion`              |
| `11_COLOMBIAN_PROPERTY`     | `property_record`     |
| `12_LEASE_AGREEMENTS`       | `lease`               |
| `98_DUPLICATES`             | `duplicate`           |
| `99_UNSORTED`               | `other`               |

### Migration Checklist

- [ ] Update code to use `evidence_id` instead of `file_hash`
- [ ] Change field references (exhibit_id → evidence_number, etc.)
- [ ] Store UUIDs instead of integer IDs
- [ ] Test with `?legacy=true` during transition
- [ ] Update database schemas to use UUID columns
- [ ] Remove legacy format once fully migrated

### Environment Variables

```bash
# Optional: Enable legacy format support
EVIDENCE_LEGACY_MODE=true

# Required: Database access for compatibility layer
NEON_DATABASE_URL=postgresql://...
```

### Troubleshooting

**Error**: "Evidence not found"
- ✅ Check if using correct UUID format
- ✅ Verify evidence_id vs file_hash

**Error**: "Legacy format not available"
- ✅ Set `EVIDENCE_LEGACY_MODE=true`
- ✅ Redeploy ChittyConnect

**Error**: "Invalid UUID"
- ✅ Ensure UUID is v4 format: `xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx`
- ✅ Check for typos or truncated UUIDs

**Slow file_hash lookups**
- ⚠️ File hash requires database JOIN
- ✅ Migrate to evidence_id for 40% faster queries

### Performance Tips

1. **Use evidence_id**: ~45ms average response
2. **Avoid file_hash**: ~65ms due to JOIN overhead
3. **Batch operations**: Use case listing instead of individual lookups
4. **Cache UUIDs**: Store evidence_id for repeat access

### Support

- Documentation: [CLAUDE.md](CLAUDE.md)
- Migration Guide: [CHITTYEVIDENCE_V2_MIGRATION.md](CHITTYEVIDENCE_V2_MIGRATION.md)
- Issues: connect@chitty.cc

---

**Version**: ChittyConnect v2.0
**Updated**: 2025-11-15
**Backward Compatible**: Yes ✅
