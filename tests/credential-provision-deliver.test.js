// Issue #380: value-free provisioning of a Cloudflare token delivered
// straight into a worker secret.
//
// These tests drive the real POST /api/credentials/provision route and the
// real EnhancedCredentialProvisioner. The only stand-in is globalThis.fetch
// for api.cloudflare.com, the same approach tests/cloudflare-account-token-api
// .test.js takes: every request the code emits is recorded and asserted on.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { credentialsRoutes } from '../src/api/routes/credentials.js';

const ACCOUNT_ID = '0bc21e3a5a9de1a4cc843be9c3e98121';
const CF = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`;

function makeEnv() {
  const kv = new Map();
  return {
    CREDENTIAL_BROKER_TYPE: 'cloudflare-secrets',
    CLOUDFLARE_MAKE_API_KEY: 'test-binding-value-not-a-real-credential',
    CHITTYOS_ACCOUNT_ID: ACCOUNT_ID,
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
      secret_name: 'CF_MCP_PORTALS_TOKEN',
    },
  },
};

describe('POST /provision with context.deliver_to (#380)', () => {
  let realFetch;
  let seen;
  let tokenValue;
  let secretsPutStatus;
  let logged;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    seen = [];
    secretsPutStatus = 200;
    // Fresh per test so a match can only come from this run's mint.
    tokenValue = `cftest-${crypto.randomUUID()}`;
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
        return jsonOk({
          success: true,
          result: {
            id: 'tok-380',
            name: 'test token',
            value: tokenValue,
            expires_on: '2027-01-24T00:00:00Z',
          },
        });
      }
      if (u.startsWith(`${CF}/workers/scripts/`) && method === 'PUT') {
        // A failing body that echoes the request, to prove the error path
        // does not pass a Cloudflare body through.
        return secretsPutStatus === 200
          ? jsonOk({ success: true, result: { name: 'x', type: 'secret_text' } })
          : jsonOk({ success: false, errors: [{ message: `echo ${init.body}` }] }, secretsPutStatus);
      }
      if (u.startsWith(`${CF}/tokens/`) && method === 'DELETE') {
        return jsonOk({ success: true, result: { id: 'tok-380' } });
      }
      return jsonOk({ success: true, result: {} });
    };
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  const tokenCreates = () =>
    seen.filter((r) => r.url === `${CF}/tokens` && r.method === 'POST');

  it('G1: delivers the value to the worker secret and never returns or logs it', async () => {
    const res = await post(DELIVER_BODY, makeEnv());
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).not.toContain(tokenValue);
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) expect(line).not.toContain(tokenValue);

    const body = JSON.parse(text);
    expect(Object.keys(body).sort()).toEqual(
      ['expires_on', 'permissions', 'script', 'secret_name', 'token_id'],
    );
    expect(body).toEqual({
      token_id: 'tok-380',
      secret_name: 'CF_MCP_PORTALS_TOKEN',
      script: 'chittyagent-mcp-builder',
      expires_on: '2027-01-24T00:00:00Z',
      permissions: ['MCP Portals Write', 'Account Settings Read'],
    });

    const puts = seen.filter((r) => r.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect(puts[0].url).toBe(`${CF}/workers/scripts/chittyagent-mcp-builder/secrets`);
    expect(JSON.parse(puts[0].body)).toEqual({
      name: 'CF_MCP_PORTALS_TOKEN',
      text: tokenValue,
      type: 'secret_text',
    });
    expect(seen.some((r) => r.method === 'DELETE')).toBe(false);
  });

  it('G1: deliver_to.environment addresses the wrangler environment script', async () => {
    const body = structuredClone(DELIVER_BODY);
    body.context.deliver_to.environment = 'production';
    const res = await post(body, makeEnv());
    expect(res.status).toBe(200);
    const puts = seen.filter((r) => r.method === 'PUT');
    expect(puts[0].url).toBe(
      `${CF}/workers/scripts/chittyagent-mcp-builder-production/secrets`,
    );
    expect((await res.json()).script).toBe('chittyagent-mcp-builder-production');
  });

  it('G2: a script outside the allow-list is refused with 403 before any token exists', async () => {
    for (const script of ['chittyconnect', 'chittyagent-mcp-builder-evil', '', null]) {
      const body = structuredClone(DELIVER_BODY);
      body.context.deliver_to.script = script;
      const res = await post(body, makeEnv());
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('deliver_target_not_allowed');
    }
    expect(tokenCreates()).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  it('G3: a failed secret write revokes the created token and returns no value', async () => {
    secretsPutStatus = 500;
    const res = await post(DELIVER_BODY, makeEnv());
    const text = await res.text();

    expect(res.status).toBe(502);
    expect(text).not.toContain(tokenValue);
    for (const line of logged) expect(line).not.toContain(tokenValue);
    expect(JSON.parse(text).error.code).toBe('deliver_failed');

    expect(tokenCreates()).toHaveLength(1);
    const deletes = seen.filter((r) => r.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].url).toBe(`${CF}/tokens/tok-380`);
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

  it('rejects deliver_to on a type whose provisioner returns the value', async () => {
    const res = await post(
      {
        type: 'neon_api_key',
        context: {
          purpose: 'x',
          deliver_to: { script: 'chittyagent-mcp-builder', secret_name: 'NEON_API_KEY' },
        },
      },
      makeEnv(),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('deliver_to_invalid');
    expect(seen).toHaveLength(0);
  });

  it('without deliver_to, the existing response shape is unchanged', async () => {
    const body = structuredClone(DELIVER_BODY);
    delete body.context.deliver_to;
    const res = await post(body, makeEnv());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.credential.value).toBe(tokenValue);
    expect(json.credential.token_id).toBe('tok-380');
    expect(json.usage_instructions).toBeDefined();
    expect(seen.some((r) => r.method === 'PUT')).toBe(false);
  });
});
