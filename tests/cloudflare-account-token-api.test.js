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

function jsonOk(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
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
    // Not just the first call: no request in the whole exchange may touch
    // the user family, so a "try /user, fall back to /accounts" shape
    // cannot pass this test.
    expect(seen.every((r) => !r.url.includes('/client/v4/user/tokens'))).toBe(true);
  });

  it('refuses to fetch the catalog without an account — the catalog is account-scoped', async () => {
    const p = makeProvisioner();
    await expect(p.fetchCloudflarePermissions('k')).rejects.toThrow(
      /requires accountId/,
    );
    expect(seen).toHaveLength(0);
  });

  it('records per-group provenance, not a single coarse flag', async () => {
    const p = makeProvisioner();
    // Empty catalog result => nothing resolved dynamically => fallback IDs.
    await p.fetchCloudflarePermissions('k', ACCOUNT_ID);
    expect(p.permissionGroupsSource).toBe('fallback');
    expect(p.catalogResolvedKeys.size).toBe(0);
  });

  it('fails closed when the catalog is unreadable instead of minting from unread IDs', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 9109, message: 'Unauthorized to access requested resource' }],
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    const p = makeProvisioner();
    await expect(p.fetchCloudflarePermissions('k', ACCOUNT_ID)).rejects.toThrow(
      /POLICY_BLOCKED_PERMISSION_CATALOG_UNAVAILABLE/,
    );
    expect(p.permissionGroupsSource).toBe('unavailable');
  });

  it('refuses to mint when a required group resolved from the static fallback', async () => {
    // Catalog answers 200 but resolves nothing — exactly the shape that
    // previously let hardcoded IDs stand in silently.
    const p = makeProvisioner();
    await p.getCloudflarePermissions('k', ACCOUNT_ID);
    expect(p.catalogResolvedKeys.size).toBe(0);

    await expect(
      p.provisionCloudflareToken(
        'cloudflare_workers_deploy',
        { service: 'chittyconnect', purpose: 'test', environment: 'production' },
        'chittyconnect',
      ),
    ).rejects.toThrow(/POLICY_BLOCKED_PERMISSION_UNVERIFIED/);
  });

  it('says WHICH failure it is — a name-matching gap reads differently from an unread catalog', async () => {
    // Catalog answers 200 with real-looking groups whose names do not
    // match the normalizer's substring patterns. Scope is still
    // unverified, but the cause is entirely different from a 403 — and
    // an operator reading the error must be able to tell them apart.
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: [{ id: 'abc', name: 'Some Group The Normalizer Misses' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    const p = makeProvisioner();
    await p.getCloudflarePermissions('k', ACCOUNT_ID);

    await expect(
      p.provisionCloudflareToken(
        'cloudflare_workers_deploy',
        { service: 'chittyconnect', purpose: 'test', environment: 'production' },
        'chittyconnect',
      ),
    ).rejects.toThrow(
      // The catalog WAS read — that is the part this message must convey,
      // and it must convey it without claiming to know why the groups did
      // not resolve. "0 of 3 required keys resolved" is checkable; "this
      // is a name-matching gap, NOT a missing grant" was not.
      /catalog read OK and returned 1 groups .*0 of 3 required keys resolved/,
    );
  });

  it('does not assert a cause it cannot distinguish', async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          success: true,
          result: [{ id: 'abc', name: 'Some Group The Normalizer Misses' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    const p = makeProvisioner();
    await p.getCloudflarePermissions('k', ACCOUNT_ID);

    const err = await p
      .provisionCloudflareToken(
        'cloudflare_workers_deploy',
        { service: 'chittyconnect', purpose: 'test', environment: 'production' },
        'chittyconnect',
      )
      .then(() => null, (e) => e);

    expect(err).toBeTruthy();
    expect(err.message).not.toMatch(/NOT a missing grant/);
    expect(err.message).toMatch(/cannot distinguish those two/);
  });

  it('reports partial catalog resolution as partial, not as "none matched"', async () => {
    // Three of the four deploy groups resolve; Routes Write does not.
    // The old message said none of them normalized, which sent operators
    // at a name-matching gap that had already half-resolved.
    globalThis.fetch = async (url) => {
      if (String(url).includes('/tokens/permission_groups')) {
        return jsonOk({
          success: true,
          result: [
            { id: 'g-scripts', name: 'Workers Scripts Write' },
            { id: 'g-kv', name: 'Workers KV Storage Write' },
          ],
        });
      }
      return jsonOk({ success: true, result: {} });
    };
    const p = makeProvisioner();
    await p.getCloudflarePermissions('k', ACCOUNT_ID);

    // accountSettingsRead is missing from the catalog and IS account-scoped,
    // so it still blocks the mint — the gate narrows to included
    // permissions, it does not go soft.
    const err = await p
      .provisionCloudflareToken(
        'cloudflare_workers_deploy',
        { service: 'chittyconnect', purpose: 'test', environment: 'production' },
        'chittyconnect',
      )
      .then(() => null, (e) => e);

    expect(err.message).toMatch(/POLICY_BLOCKED_PERMISSION_UNVERIFIED/);
    expect(err.message).toMatch(/2 of 3 required keys resolved from it/);
    expect(err.message).toMatch(/workersScriptsWrite, workersKVWrite/);
  });

  it('does not let a dropped zone permission block a zone-less mint', async () => {
    // Every ACCOUNT-scoped deploy group resolves from the catalog; only
    // the zone-scoped Routes Write is absent. The caller passed no zones,
    // so Routes Write is dropped before the token is built — a permission
    // that never reaches the token must not be able to veto the mint.
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes('/tokens/permission_groups')) {
        return jsonOk({
          success: true,
          result: [
            { id: 'g-scripts', name: 'Workers Scripts Write' },
            { id: 'g-kv', name: 'Workers KV Storage Write' },
            { id: 'g-settings', name: 'Account Settings Read' },
          ],
        });
      }
      if (u.endsWith(`/accounts/${ACCOUNT_ID}/tokens`) && init?.method === 'POST') {
        return jsonOk({
          success: true,
          result: {
            id: 'tok-1',
            name: 'test token',
            value: 'not-a-real-token-value',
            expires_on: '2027-01-01T00:00:00Z',
          },
        });
      }
      return jsonOk({ success: true, result: {} });
    };
    const p = makeProvisioner();
    await p.getCloudflarePermissions('k', ACCOUNT_ID);

    const result = await p.provisionCloudflareToken(
      'cloudflare_workers_deploy',
      { service: 'chittyconnect', purpose: 'test', environment: 'production' },
      'chittyconnect',
    );

    expect(result.success).toBe(true);
    // Routes Write is not in the token, so it is not in the reported scopes.
    expect(result.credential.scopes).toEqual([
      'Workers Scripts Write',
      'Workers KV Storage Write',
      'Account Settings Read',
    ]);
    // And the provenance claim is derived from exactly those groups.
    expect(result.metadata.permission_source).toBe('account-catalog');
  });

  it('still blocks when an account-scoped permission is the unverified one', async () => {
    // Same shape as above minus Account Settings Read — an account-scoped
    // group that DOES reach the token. Narrowing the gate to included
    // permissions must not weaken it for those.
    globalThis.fetch = async (url) => {
      if (String(url).includes('/tokens/permission_groups')) {
        return jsonOk({
          success: true,
          result: [
            { id: 'g-scripts', name: 'Workers Scripts Write' },
            { id: 'g-kv', name: 'Workers KV Storage Write' },
          ],
        });
      }
      return jsonOk({ success: true, result: {} });
    };
    const p = makeProvisioner();
    await p.getCloudflarePermissions('k', ACCOUNT_ID);

    await expect(
      p.provisionCloudflareToken(
        'cloudflare_workers_deploy',
        { service: 'chittyconnect', purpose: 'test', environment: 'production' },
        'chittyconnect',
      ),
    ).rejects.toThrow(/POLICY_BLOCKED_PERMISSION_UNVERIFIED: accountSettingsRead/);
  });

  it('normalizes both spellings Cloudflare uses for the D1 write group', async () => {
    // The account catalog names 5e2c30acd1434ea2adfb8442c3cbbbea "D1 Write";
    // the static fallback spells it "D1 Database Write". Matching only
    // "d1Database" left d1DatabaseWrite unresolved on every real read, so
    // the provenance gate permanently blocked cloudflare_d1_access.
    for (const name of ['D1 Write', 'D1 Database Write']) {
      globalThis.fetch = async () =>
        jsonOk({
          success: true,
          result: [{ id: '5e2c30acd1434ea2adfb8442c3cbbbea', name }],
        });
      const p = makeProvisioner();
      await p.fetchCloudflarePermissions('k', ACCOUNT_ID);
      expect(p.catalogResolvedKeys.has('d1DatabaseWrite')).toBe(true);
    }
  });

  it('does not normalize D1 read groups onto the write key', async () => {
    globalThis.fetch = async () =>
      jsonOk({
        success: true,
        result: [{ id: 'g-d1-read', name: 'D1 Read' }],
      });
    const p = makeProvisioner();
    await p.fetchCloudflarePermissions('k', ACCOUNT_ID);
    expect(p.catalogResolvedKeys.has('d1DatabaseWrite')).toBe(false);
  });
});
