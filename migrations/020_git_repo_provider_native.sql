-- 020_git_repo_provider_native.sql
--
-- Reconcile the existing git_repo_allowlist with the provider-native GitHub
-- execution model adopted by chittyconnect#209 / chittyentity#789.
--
-- No new table/schema: path_prefix is retained for compatibility, but its value
-- is now a canonical GitHub repository locator prefix ("owner/") rather than a
-- host filesystem path. The policy remains per-tenant and fail-closed.

UPDATE git_repo_allowlist
SET
  path_prefix = 'chittyos/',
  notes = 'GitHub owner/repo prefix; provider-native #209 policy',
  updated_at = datetime('now')
WHERE tenant_id = 'chittyos-default'
  AND path_prefix = '/home/ubuntu/projects/github.com/CHITTYOS/';

UPDATE git_repo_allowlist
SET
  path_prefix = 'chittyfoundation/',
  notes = 'GitHub owner/repo prefix; provider-native #209 policy',
  updated_at = datetime('now')
WHERE tenant_id = 'chittyos-default'
  AND path_prefix = '/home/ubuntu/projects/github.com/CHITTYFOUNDATION/';
