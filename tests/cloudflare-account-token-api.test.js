// Regression: the provisioner addressed the WRONG Cloudflare API token family.
//
// Live probe 2026-08-31 against account 0bc21e3a…, using the account-owned
// token the estate actually holds (verified active via
// /accounts/{id}/tokens/verify, and 200 on /accounts/{id}/workers/scripts):
//
//   GET /client/v4/user/tokens/permission_groups
//     -> 403 code 9109 "Valid user-level authentication not found"
//   GET /client/v4/accounts/{acc}/tokens/permission_groups
//     -> 403 code 9109 "Unauthorized to access requested resource"
//
// Two different failures. The first says "wrong family for this bearer"; the
// second says "right family, missing API Tokens Write". This change fixes the
// first. The second is a permission grant tracked separately — so these tests
// assert the request the provisioner EMITS, which is the part this diff owns.
//
// The outbound fetch is observed, not stubbed away: the assertions are about a
// real Request the real code path constructs.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EnhancedCredentialProvisioner } from '../src/services/credential-provisioner-enhanced.js';

const ACCOUNT_ID = '0bc21e3a5a9de1a4cc843be9c3e98121';

function makeProvisioner() {
  const p = new EnhancedCredentialProvisioner({
    CREDENTIAL_BROKER_TYPE: 'cloudflare-secrets',
    CLOUDFLARE_MAKE_API_KEY: 'test-binding-value-not-a-real-credential',
    CHITTYOS_ACCOUNT_ID: ACCOUNT_ID,
  });
  return p;
}

describe('Cloudflare API token family', () => {
  let realFetch;
  let seen;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    seen = [];
    globalThis.fetch = async (url, init) => {
      seen.push({ url: String(url), method: init?.method || 'GET' });
      return new Response(JSON.stringify({ success: true, result: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('reads the permission-groups catalog from the account, not /user', async () => {
    const p = makeProvisioner();
    await p.fetchCloudflarePermissions('k', ACCOUNT_ID);

    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/tokens/permission_groups`,
    );
    expect(seen[0].url).not.toContain('/client/v4/user/tokens');
  });

  it('refuses to fetch the catalog without an account — the catalog is account-scoped', async () => {
    const p = makeProvisioner();
    await expect(p.fetchCloudflarePermissions('k')).rejects.toThrow(
      /requires accountId/,
    );
    expect(seen).toHaveLength(0);
  });

  it('records permission provenance so a fallback-sourced token is not mistaken for a verified one', async () => {
    const p = makeProvisioner();
    // Empty catalog result => nothing resolved dynamically => fallback IDs.
    await p.fetchCloudflarePermissions('k', ACCOUNT_ID);
    expect(p.permissionGroupsSource).toBe('fallback');
  });

  it('marks provenance as fallback when the catalog call fails outright', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 9109, message: 'Unauthorized to access requested resource' }],
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    const p = makeProvisioner();
    const perms = await p.fetchCloudflarePermissions('k', ACCOUNT_ID);
    expect(p.permissionGroupsSource).toBe('fallback');
    // Still returns the static fallback rather than throwing — preserved
    // behavior, but now observable.
    expect(Object.keys(perms).length).toBeGreaterThan(0);
  });
});
