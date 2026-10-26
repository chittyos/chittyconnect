// Issue #380: value-free provisioning of a Cloudflare token delivered
// straight into a worker secret.
//
// These tests drive the real POST /api/credentials/provision route and the
// real EnhancedCredentialProvisioner. The only stand-in is globalThis.fetch
// for api.cloudflare.com, the same approach tests/cloudflare-account-token-api
// .test.js takes: every request the code emits is recorded and asserted on.
// env.DB is a real SQLite database (node:sqlite) built from the production
// migration, wrapped in the D1 prepare/bind/run/all surface.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { credentialsRoutes } from '../src/api/routes/credentials.js';

const ACCOUNT_ID = '0bc21e3a5a9de1a4cc843be9c3e98121';
const CF = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`;
const CHRONICLE = 'https://chronicle.chitty.cc';

function makeD1() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['001_credential_provisions.sql', '020_credential_delivery_leases.sql']) {
    db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  return {
    raw: db,
    prepare(sql) {
      const stmt = db.prepare(sql);
      const bound = (args) => ({
        bind: (...next) => bound(next),
        run: async () => stmt.run(...args),
        all: async () => ({ results: stmt.all(...args) }),
        first: async () => stmt.get(...args) ?? null,
      });
      return bound([]);
    },
  };
}

function makeEnv(db = makeD1()) {
  const kv = new Map();
  return {
    CREDENTIAL_BROKER_TYPE: 'cloudflare-secrets',
    CLOUDFLARE_MAKE_API_KEY: 'test-binding-value-not-a-real-credential',
    CHITTYOS_ACCOUNT_ID: ACCOUNT_ID,
    CHITTYCHRONICLE_SERVICE_URL: CHRONICLE,
    DB: db,
    RATE_LIMIT: {
      get: async (k) => kv.get(k) ?? null,
      put: async (k, v) => {
        kv.set(k, v);
      },
    },
  };
}

function jsonOk(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const CATALOG = [
  { id: 'g-mcp-portals-write', name: 'MCP Portals Write' },
  { id: 'g-mcp-portals-read', name: 'MCP Portals Read' },
  { id: 'g-settings', name: 'Account Settings Read' },
];

function post(body, env) {
  return credentialsRoutes.request(
    '/provision',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );
}

const DELIVER_BODY = {
  type: 'cloudflare_access_mcp_portals',
  context: {
    service: 'chittyagent-mcp-builder',
    purpose: 'mcp-portal-management',
    deliver_to: {
      script: 'chittyagent-mcp-builder',
      secret_name: 'CF_API_TOKEN',
    },
  },
};

describe('POST /provision with context.deliver_to (#380)', () => {
  let realFetch;
  let seen;
  let tokenValues;
  let mintCount;
  // 'ok' | 'error' | 'success-false' | 'unparseable' | 'throw' | 'hold-once'
  let secretsPut;
  // For 'hold-once': the first PUT resolves `entered` and waits on `release`.
  let hold;
  let deleteStatus;
  let logged;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    seen = [];
    secretsPut = 'ok';
    deleteStatus = 200;
    hold = null;
    mintCount = 0;
    // Fresh per mint so a match can only come from this run.
    tokenValues = [];
    logged = [];
    for (const level of ['log', 'warn', 'error', 'info', 'debug']) {
      vi.spyOn(console, level).mockImplementation((...args) => {
        logged.push(
          args
            .map((a) =>
              a instanceof Error ? `${a.message}\n${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a),
            )
            .join(' '),
        );
      });
    }
    globalThis.fetch = async (url, init = {}) => {
      const u = String(url);
      const method = init.method || 'GET';
      seen.push({ url: u, method, body: init.body });
      if (u === `${CF}/tokens/permission_groups`) {
        return jsonOk({ success: true, result: CATALOG });
      }
      if (u === `${CF}/tokens` && method === 'POST') {
        mintCount += 1;
        const value = `cftest-${crypto.randomUUID()}`;
        tokenValues.push(value);
        return jsonOk({
          success: true,
          result: {
            id: `tok-${mintCount}`,
            name: 'test token',
            value,
            expires_on: '2027-01-24T00:00:00Z',
          },
        });
      }
      if (u.startsWith(`${CF}/workers/scripts/`) && method === 'PUT') {
        if (secretsPut === 'hold-once') {
          secretsPut = 'ok';
          hold.entered();
          await hold.released;
          return jsonOk({ success: true, result: { name: 'x', type: 'secret_text' } });
        }
        switch (secretsPut) {
          case 'ok':
            return jsonOk({ success: true, result: { name: 'x', type: 'secret_text' } });
          case 'unparseable':
            return new Response('<html>ok</html>', { status: 200 });
          case 'success-false':
            return jsonOk({ success: false, errors: [{ message: `echo ${init.body}` }] }, 200);
          case 'throw':
            throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
          default:
            // A failing body that echoes the request, to prove the error
            // path does not pass a Cloudflare body through.
            return jsonOk({ success: false, errors: [{ message: `echo ${init.body}` }] }, 500);
        }
      }
      if (u.startsWith(`${CF}/tokens/`) && method === 'DELETE') {
        return deleteStatus === 200
          ? jsonOk({ success: true, result: { id: u.split('/').pop() } })
          : jsonOk({ success: false, errors: [{ message: 'nope' }] }, deleteStatus);
      }
      return jsonOk({ success: true, result: {} });
    };
  });

  afterEach(() => {
    hold?.release();
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  const tokenCreates = () =>
    seen.filter((r) => r.url === `${CF}/tokens` && r.method === 'POST');
  const deletes = () => seen.filter((r) => r.method === 'DELETE');
  const cloudflareCalls = () => seen.filter((r) => r.url.startsWith('https://api.cloudflare.com/'));
  const chroniclePosts = () => seen.filter((r) => r.url.startsWith(CHRONICLE));

  function expectNoValueLeak(text, db) {
    expect(tokenValues.length).toBeGreaterThan(0);
    for (const value of tokenValues) {
      expect(text).not.toContain(value);
      for (const line of logged) expect(line).not.toContain(value);
      for (const r of chroniclePosts()) expect(String(r.body)).not.toContain(value);
      if (db) {
        const rows = db.raw.prepare('SELECT * FROM credential_provisions').all();
        expect(JSON.stringify(rows)).not.toContain(value);
      }
    }
  }

  async function expectRefusedBeforeCloudflare(body, status, code) {
    const res = await post(body, makeEnv());
    expect(res.status).toBe(status);
    expect((await res.json()).error.code).toBe(code);
    expect(seen).toHaveLength(0);
  }

  it('G1: delivers the value to the worker secret and never returns or logs it', async () => {
    const env = makeEnv();
    const res = await post(DELIVER_BODY, env);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(logged.length).toBeGreaterThan(0);
    // The Chronicle leak check below is not vacuous: the event was posted.
    expect(chroniclePosts()).toHaveLength(1);
    expectNoValueLeak(text, env.DB);

    const body = JSON.parse(text);
    expect(body).toEqual({
      token_id: 'tok-1',
      secret_name: 'CF_API_TOKEN',
      script: 'chittyagent-mcp-builder',
      expires_on: '2027-01-24T00:00:00Z',
      permissions: ['MCP Portals Write', 'Account Settings Read'],
      previous_token: { status: 'none', token_ids: [] },
    });

    const puts = seen.filter((r) => r.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(JSON.parse(puts[0].body)).toEqual({
      name: 'CF_API_TOKEN',
      text: tokenValues[0],
      type: 'secret_text',
    });
    expect(deletes()).toHaveLength(0);
  });

  it('F1: cloudflare_access_mcp_portals without deliver_to is refused before any Cloudflare call', async () => {
    const body = structuredClone(DELIVER_BODY);
    delete body.context.deliver_to;
    await expectRefusedBeforeCloudflare(body, 400, 'deliver_to_required');
  });

  it('F2: a wrong secret_name, type, or script is refused with 403 before any Cloudflare call', async () => {
    const wrongSecret = structuredClone(DELIVER_BODY);
    wrongSecret.context.deliver_to.secret_name = 'CF_MCP_PORTALS_TOKEN';
    await expectRefusedBeforeCloudflare(wrongSecret, 403, 'deliver_target_not_allowed');

    const wrongType = structuredClone(DELIVER_BODY);
    wrongType.type = 'cloudflare_workers_deploy';
    await expectRefusedBeforeCloudflare(wrongType, 403, 'deliver_target_not_allowed');

    const valueType = {
      type: 'neon_api_key',
      context: { purpose: 'x', deliver_to: structuredClone(DELIVER_BODY.context.deliver_to) },
    };
    await expectRefusedBeforeCloudflare(valueType, 403, 'deliver_target_not_allowed');

    for (const script of ['chittyconnect', 'chittyagent-mcp-builder-evil', '', null]) {
      const wrongScript = structuredClone(DELIVER_BODY);
      wrongScript.context.deliver_to.script = script;
      await expectRefusedBeforeCloudflare(wrongScript, 403, 'deliver_target_not_allowed');
    }
  });

  it('F3: writes to exactly the allow-listed script and rejects deliver_to.environment', async () => {
    const res = await post(DELIVER_BODY, makeEnv());
    expect(res.status).toBe(200);
    const puts = seen.filter((r) => r.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toBe(`${CF}/workers/scripts/chittyagent-mcp-builder/secrets`);

    seen = [];
    const body = structuredClone(DELIVER_BODY);
    body.context.deliver_to.environment = 'production';
    await expectRefusedBeforeCloudflare(body, 400, 'deliver_to_invalid');
  });

  it('F4: re-delivery revokes the previous token for the target', async () => {
    const env = makeEnv();
    expect((await post(DELIVER_BODY, env)).status).toBe(200);
    expect(deletes()).toHaveLength(0);

    const res = await post(DELIVER_BODY, env);
    const text = await res.text();
    expect(res.status).toBe(200);
    expectNoValueLeak(text, env.DB);
    const body = JSON.parse(text);
    expect(body.token_id).toBe('tok-2');
    expect(body.previous_token).toEqual({ status: 'revoked', token_ids: ['tok-1'] });

    expect(deletes().map((r) => r.url)).toEqual([`${CF}/tokens/tok-1`]);
    const rows = env.DB.raw
      .prepare('SELECT token_id, revoked_at FROM credential_provisions ORDER BY id')
      .all();
    expect(rows.map((r) => [r.token_id, r.revoked_at !== null])).toEqual([
      ['tok-1', true],
      ['tok-2', false],
    ]);

    // A third delivery revokes only tok-2: tok-1 is already marked revoked.
    const third = await post(DELIVER_BODY, env);
    expect((await third.json()).previous_token).toEqual({ status: 'revoked', token_ids: ['tok-2'] });
    expect(deletes().map((r) => r.url)).toEqual([`${CF}/tokens/tok-1`, `${CF}/tokens/tok-2`]);
  });

  it('F4: a failed revoke of the previous token is surfaced, not swallowed', async () => {
    const env = makeEnv();
    expect((await post(DELIVER_BODY, env)).status).toBe(200);

    deleteStatus = 500;
    const res = await post(DELIVER_BODY, env);
    const text = await res.text();
    expect(res.status).toBe(200);
    expectNoValueLeak(text, env.DB);
    expect(JSON.parse(text).previous_token).toEqual({
      status: 'revoke_failed',
      token_ids: ['tok-1'],
    });
    const tok1 = env.DB.raw
      .prepare('SELECT revoked_at FROM credential_provisions WHERE token_id = ?')
      .get('tok-1');
    expect(tok1.revoked_at).toBeNull();
  });

  it('F5: a 2xx secrets PUT with an unparseable body counts as delivered', async () => {
    secretsPut = 'unparseable';
    const res = await post(DELIVER_BODY, makeEnv());
    const text = await res.text();
    expect(res.status).toBe(200);
    expectNoValueLeak(text);
    expect(JSON.parse(text).token_id).toBe('tok-1');
    expect(deletes()).toHaveLength(0);
  });

  it('F5: a timed-out secrets PUT returns 502 deliver_unknown with the token id and does not revoke', async () => {
    secretsPut = 'throw';
    const res = await post(DELIVER_BODY, makeEnv());
    const text = await res.text();
    expect(res.status).toBe(502);
    expectNoValueLeak(text);
    const { error } = JSON.parse(text);
    expect(error.code).toBe('deliver_unknown');
    expect(error.token_id).toBe('tok-1');
    expect(deletes()).toHaveLength(0);
  });

  it('a 200 secrets PUT with success:false is a failure and revokes the token', async () => {
    secretsPut = 'success-false';
    const res = await post(DELIVER_BODY, makeEnv());
    const text = await res.text();
    expect(res.status).toBe(502);
    expectNoValueLeak(text);
    expect(JSON.parse(text).error.code).toBe('deliver_failed');
    expect(deletes().map((r) => r.url)).toEqual([`${CF}/tokens/tok-1`]);
  });

  it('F6: ip_restrictions with deliver_to is refused before any Cloudflare call', async () => {
    const body = structuredClone(DELIVER_BODY);
    body.context.ip_restrictions = ['192.0.2.10/32'];
    await expectRefusedBeforeCloudflare(body, 400, 'deliver_to_invalid');
  });

  it('G3: a failed secret write revokes the created token and returns no value', async () => {
    secretsPut = 'error';
    const res = await post(DELIVER_BODY, makeEnv());
    const text = await res.text();

    expect(res.status).toBe(502);
    expectNoValueLeak(text);
    expect(JSON.parse(text).error.code).toBe('deliver_failed');

    expect(tokenCreates()).toHaveLength(1);
    expect(deletes().map((r) => r.url)).toEqual([`${CF}/tokens/tok-1`]);
  });

  it('G4: cloudflare_access_mcp_portals requests the MCP Portals Write group', async () => {
    const res = await post(DELIVER_BODY, makeEnv());
    expect(res.status).toBe(200);
    const [create] = tokenCreates();
    const request = JSON.parse(create.body);
    expect(request.policies).toHaveLength(1);
    expect(request.policies[0].resources).toEqual({
      [`com.cloudflare.api.account.${ACCOUNT_ID}`]: '*',
    });
    expect(request.policies[0].permission_groups).toEqual([
      { id: 'g-mcp-portals-write', name: 'MCP Portals Write', scope: 'account' },
      { id: 'g-settings', name: 'Account Settings Read', scope: 'account' },
    ]);
  });

  it('G4: refuses to mint when MCP Portals Write is absent from the account catalog', async () => {
    const inner = globalThis.fetch;
    globalThis.fetch = async (url, init) =>
      String(url).endsWith('/tokens/permission_groups')
        ? jsonOk({ success: true, result: [{ id: 'g-settings', name: 'Account Settings Read' }] })
        : inner(url, init);
    const res = await post(DELIVER_BODY, makeEnv());
    // Status is whatever the route's existing message-substring mapping
    // yields; the point is that no token is minted.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await res.json()).error.message).toMatch(/POLICY_BLOCKED_PERMISSION_UNVERIFIED: mcpPortalsWrite/);
    expect(tokenCreates()).toHaveLength(0);
  });

  it('M1: a delivery overlapping an in-flight one to the same target gets 409 with zero Cloudflare calls', async () => {
    const env = makeEnv();
    let entered;
    let release;
    const enteredP = new Promise((r) => (entered = r));
    const released = new Promise((r) => (release = r));
    hold = { entered, released, release };
    secretsPut = 'hold-once';

    const first = post(DELIVER_BODY, env);
    await enteredP; // the first request is inside the secrets PUT

    const cfBefore = cloudflareCalls().length;
    const second = await post(DELIVER_BODY, env);
    const secondText = await second.text();
    expect(second.status).toBe(409);
    expect(JSON.parse(secondText).error.code).toBe('deliver_in_progress');
    expect(cloudflareCalls()).toHaveLength(cfBefore);
    expect(mintCount).toBe(1);

    release();
    const firstRes = await first;
    const firstText = await firstRes.text();
    expect(firstRes.status).toBe(200);
    expect(JSON.parse(firstText).token_id).toBe('tok-1');
    expect(deletes()).toHaveLength(0);

    // The lease was released: a third delivery proceeds and revokes tok-1.
    const third = await post(DELIVER_BODY, env);
    const thirdText = await third.text();
    expect(third.status).toBe(200);
    expect(JSON.parse(thirdText)).toMatchObject({
      token_id: 'tok-2',
      previous_token: { status: 'revoked', token_ids: ['tok-1'] },
    });
    expect(deletes().map((r) => r.url)).toEqual([`${CF}/tokens/tok-1`]);
    expectNoValueLeak(secondText + firstText + thirdText, env.DB);
  });

  it('M1: an expired lease left by a crashed delivery is taken over', async () => {
    const env = makeEnv();
    env.DB.raw
      .prepare('INSERT INTO credential_delivery_leases (target, holder, expires_at) VALUES (?, ?, ?)')
      .run('chittyagent-mcp-builder/CF_API_TOKEN', 'crashed-request', Date.now() - 1);
    const res = await post(DELIVER_BODY, env);
    expect(res.status).toBe(200);
    expect(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM credential_delivery_leases').get().n).toBe(0);
  });

  it('L3: a timed-out delivery leaves a pending-tracked row and the next delivery revokes that token', async () => {
    const env = makeEnv();
    secretsPut = 'throw';
    const res = await post(DELIVER_BODY, env);
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(JSON.parse(text).error.code).toBe('deliver_unknown');
    const row = env.DB.raw
      .prepare('SELECT delivery_state, revoked_at FROM credential_provisions WHERE token_id = ?')
      .get('tok-1');
    expect(row).toEqual({ delivery_state: 'unknown', revoked_at: null });

    secretsPut = 'ok';
    const next = await post(DELIVER_BODY, env);
    const nextText = await next.text();
    expect(next.status).toBe(200);
    expect(JSON.parse(nextText).previous_token).toEqual({ status: 'revoked', token_ids: ['tok-1'] });
    expect(deletes().map((r) => r.url)).toEqual([`${CF}/tokens/tok-1`]);
    expectNoValueLeak(text + nextText, env.DB);
  });

  it('L3: a failed delivery whose revoke also failed is revoked by the next delivery', async () => {
    const env = makeEnv();
    secretsPut = 'error';
    deleteStatus = 500;
    const res = await post(DELIVER_BODY, env);
    expect(res.status).toBe(502);
    expect(
      env.DB.raw.prepare('SELECT delivery_state, revoked_at FROM credential_provisions WHERE token_id = ?').get('tok-1'),
    ).toEqual({ delivery_state: 'failed', revoked_at: null });

    secretsPut = 'ok';
    deleteStatus = 200;
    const next = await post(DELIVER_BODY, env);
    expect((await next.json()).previous_token).toEqual({ status: 'revoked', token_ids: ['tok-1'] });
  });

  it('L2: a non-delivery request with a deliver_to: purpose is refused before any Cloudflare call', async () => {
    await expectRefusedBeforeCloudflare(
      {
        type: 'cloudflare_workers_read',
        context: {
          service: 'chittyagent-mcp-builder',
          purpose: 'deliver_to:chittyagent-mcp-builder/CF_API_TOKEN',
        },
      },
      400,
      'purpose_reserved',
    );
  });

  it('L2: a non-delivery row matching the target is never selected for revocation', async () => {
    const env = makeEnv();
    env.DB.raw
      .prepare(
        `INSERT INTO credential_provisions (type, service, purpose, requesting_service, token_id)
         VALUES ('cloudflare_workers_read', 'chittyagent-mcp-builder',
                 'deliver_to:chittyagent-mcp-builder/CF_API_TOKEN', 'unknown', 'tok-foreign')`,
      )
      .run();
    const res = await post(DELIVER_BODY, env);
    expect((await res.json()).previous_token).toEqual({ status: 'none', token_ids: [] });
    expect(deletes()).toHaveLength(0);
  });
});
