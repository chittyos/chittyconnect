# 1Password Zero-Trust Migration Plan

**Date:** 2026-01-19
**Status:** 🔴 CRITICAL - Wide-open access needs segmentation

---

## Current State: 47 Vaults (Chaos)

### Access Problem
Currently, you have admin access to everything. Zero-trust requires:
- **Principle of least privilege** - Each identity gets minimum required access
- **Access segregation** - Services can't see what they don't need
- **Audit trails** - Know who accessed what when

---

## Proposed Vault Architecture

### Tier 0: Governance (Human-Only)
| Vault | Purpose | Access |
|-------|---------|--------|
| `NO AI ACCESS - ChittyOS Governance` | Root credentials, recovery keys | Human admin ONLY |
| `ChittyOS-Emergency` | Break-glass credentials | Human admin ONLY |

### Tier 1: Infrastructure (Service Accounts)
| Vault | Purpose | Access |
|-------|---------|--------|
| `ChittyOS-Infrastructure` | Cloudflare, Neon, Vercel platform creds | Infrastructure services |
| `ChittyOS-Deployment` | CI/CD secrets, deploy tokens | GitHub Actions, deploy pipelines |
| `ChittyOS-SSH` | SSH keys for servers | Bastion hosts only |

### Tier 2: Integrations (API Access)
| Vault | Purpose | Access |
|-------|---------|--------|
| `ChittyOS-Integrations` | Third-party API keys (OpenAI, Anthropic, etc.) | ChittyConnect only |

### Tier 3: Services (Per-Service)
| Vault | Purpose | Access |
|-------|---------|--------|
| `ChittyOS` | Service-specific secrets (DB URLs, service tokens) | Each service gets own items |
| `ChittyConnect Only` | ChittyConnect-specific secrets | ChittyConnect service only |

### Tier 4: Development (Developer Access)
| Vault | Purpose | Access |
|-------|---------|--------|
| `Claude-Code Tools` | Claude Code / AI dev tools | Developer workstations |
| `MCP Pipelines Secrets` | MCP development | MCP developers |

### Tier 5: Personal (Human-Only)
| Vault | Purpose | Access |
|-------|---------|--------|
| `Private` | Personal credentials | You only |
| `Nick Logins` | Personal logins | You only |

---

## Vaults to CONSOLIDATE

### Merge into `ChittyOS-Infrastructure`
- `ChittyOS-Core` (empty) → DELETE
- `Chitty Server SSH` → MERGE into `ChittyOS-SSH`

### Merge into `ChittyOS`
- `chittychat-secrets` → MERGE
- `LitigationAI Secrets` → MERGE (or separate legal vault)

### DELETE (Empty or Obsolete)
- `tmp-secrets` → ARCHIVE & DELETE
- `CODEX CLI SECRETS` → MIGRATE to Claude-Code Tools, DELETE

### ARCHIVE (Old Projects)
- `DIRECTV` → ARCHIVE (old client)
- `CAO_CLOUDETTE` → ARCHIVE
- `CFO_CLOUDES` → ARCHIVE

---

## Access Matrix

| Identity | Tier 0 | Tier 1 | Tier 2 | Tier 3 | Tier 4 | Tier 5 |
|----------|--------|--------|--------|--------|--------|--------|
| **Human Admin (You)** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **1Password Connect** | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **ChittyConnect Service** | ❌ | ❌ | ✅ | Own items | ❌ | ❌ |
| **GitHub Actions** | ❌ | Deploy only | ❌ | ❌ | ❌ | ❌ |
| **Claude Code (AI)** | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| **Other Services** | ❌ | ❌ | ❌ | Own items | ❌ | ❌ |

---

## Migration Steps

### Phase 1: Immediate Security (Today)
1. ✅ Create `ChittyOS` vault (done)
2. ✅ Create `ChittyOS-Integrations` vault (done)
3. [ ] Populate API keys in ChittyOS-Integrations
4. [ ] Archive duplicate/old items in Private

### Phase 2: Consolidation (This Week)
1. [ ] Merge `ChittyOS-Core` into `ChittyOS-Infrastructure` or DELETE
2. [ ] Move Cloudflare creds from Private → `ChittyOS-Infrastructure`
3. [ ] Move service DB URLs from Private → `ChittyOS`
4. [ ] Archive old project vaults (DIRECTV, etc.)

### Phase 3: Access Restriction (Next Week)
1. [ ] Configure 1Password Connect with vault-specific access
2. [ ] Update all services to use correct vaults
3. [ ] Remove direct vault access from services (use Connect only)
4. [ ] Enable audit logging

### Phase 4: Verification (Ongoing)
1. [ ] Test each service can only access its required credentials
2. [ ] Verify AI cannot access Tier 0-1 vaults
3. [ ] Document access for compliance

---

## 1Password Connect Configuration

The Connect server should ONLY have access to:
```
Tier 1: ChittyOS-Infrastructure
Tier 2: ChittyOS-Integrations
Tier 3: ChittyOS, ChittyConnect Only
```

**NOT:**
- Tier 0 (Governance/Emergency)
- Tier 4 (Development - direct CLI only)
- Tier 5 (Personal)

---

## Items to Move from Private

### To `ChittyOS-Infrastructure`
| Item | Current Location | Target |
|------|------------------|--------|
| Cloudflare credentials | Private/nick@chittycorp.com - cloudflare | ChittyOS-Infrastructure/cloudflare |
| Neon platform creds | Private/chittyfoundation_neon_api_key | ChittyOS-Infrastructure/neon |
| Vercel secrets | Private/Vercel_Protection_Bypass_Secret | ChittyOS-Infrastructure/vercel |

### To `ChittyOS`
| Item | Current Location | Target |
|------|------------------|--------|
| Neon DB strings | Private/ChittyScheme Neon DB Connection Strings | ChittyOS/neon-databases |
| GitHub App key | Private/ChittyConnect GitHub App Private Key | ChittyOS/chittyconnect-github-app |
| Service configs | Various | ChittyOS/{service}-prod |

### To `ChittyOS-Integrations`
| Item | Current Location | Target |
|------|------------------|--------|
| Neon API key | ✅ Done | ChittyOS-Integrations/neon |
| OpenAI API key | Private/Openai or ChittyOS Architect | ChittyOS-Integrations/openai |
| Anthropic API key | Private/anthropic-ai | ChittyOS-Integrations/anthropic |
| Notion token | Private/Notion Integrations | ChittyOS-Integrations/notion |
| GitHub PAT | ✅ Done | ChittyOS-Integrations/github |

---

## Cleanup: Items to Archive

### Duplicates
| Item | ID | Reason |
|------|-----|--------|
| Neon (login) | mgk67lthqvmo462fleq22xuodq | Superseded |
| Neon (login) | zfgzgpiaisqdlrdpzotr6h2rfe | Superseded |
| NEON_ORG-WIDE_API_KEYS | yuz2e2d5tlzlhetuo33xwbo7he | Superseded |
| Notion (login) | oqynvqpeivv74m3npcfux6p4yq | Superseded |
| Notion (login) | xsnzjicihjxbq7eutz45pu2fuy | Superseded |
| ChittyCases (dup) | luiqhqyhzyba7fhryysxcrsh2q | Duplicate |

### Test Items
| Item | ID | Reason |
|------|-----|--------|
| GITHUB TEST TOKEN | ccxj5dagexrih3kmq4dz53ueq4 | Test |
| Github TestToken2 | 7gupohrmmszplxqo7d6fneze2q | Test |

### Old Files
| Item | ID | Reason |
|------|-----|--------|
| CODEX GITHUB CI/CD Credentials File | sgvh5cwtuaw72szmjwppbelqvu | Old doc |
| Github Credentials File | gvlftwrc3eybrgdoln7r67n37m | Old doc |

### Old Projects
| Item | ID | Reason |
|------|-----|--------|
| Human Potential OPENAI | poofjuh3qq6my7oxeet2olubce | Old project |

---

## Vaults to Delete (After Consolidation)

| Vault | Reason |
|-------|--------|
| `ChittyOS-Core` | Empty, superseded by ChittyOS |
| `tmp-secrets` | Temporary, should be empty |
| `CODEX CLI SECRETS` | Migrate to Claude-Code Tools |

---

## Next Actions

Run the cleanup script:
```bash
bash /Volumes/chitty/workspace/scripts/1password-cleanup.sh
```

This will:
1. Populate ChittyOS-Integrations with real values
2. Archive duplicate/old items
3. Move service items to ChittyOS vault
