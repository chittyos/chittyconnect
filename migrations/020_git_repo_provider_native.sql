-- 020_git_repo_provider_native.sql
--
-- Reconcile the existing git_repo_allowlist with the provider-native GitHub
-- execution model adopted by chittyconnect#209 / chittyentity#789.
--
-- No new table/schema: path_prefix is retained for compatibility, but its value
-- is now a canonical GitHub repository locator prefix ("owner/") rather than a
-- host filesystem path. The policy remains per-tenant and fail-closed.
--
-- INSERT+DELETE (rather than UPDATE of the PK) makes the migration safe if an
-- operator already inserted the provider-native row before this migration ran.

INSERT OR IGNORE INTO git_repo_allowlist
  (tenant_id, path_prefix, access, notes)
VALUES
  (
    'chittyos-default',
    'chittyos/',
    'readwrite',
    'GitHub owner/repo prefix; provider-native #209 policy'
  ),
  (
    'chittyos-default',
    'chittyfoundation/',
    'readwrite',
    'GitHub owner/repo prefix; provider-native #209 policy'
  );

DELETE FROM git_repo_allowlist
WHERE tenant_id = 'chittyos-default'
  AND path_prefix IN (
    '/home/ubuntu/projects/github.com/CHITTYOS/',
    '/home/ubuntu/projects/github.com/CHITTYFOUNDATION/'
  );
