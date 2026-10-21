/**
 * Runtime contracts of the `agents` SDK that McpConnectAgent depends on.
 *
 * Nothing else in this repo instantiates McpAgent or exercises serve() /
 * routeAgentRequest, so the Node suite is structurally blind to an `agents`
 * upgrade. Every assertion here is a binding/lifecycle property that only
 * shows up in workerd: a real Durable Object, the real SDK router, the real
 * MCP transport. No module is mocked — a mock cannot observe the lifecycle
 * these tests exist to pin.
 */
import { describe, it, expect } from "vitest";
import { env, SELF, runInDurableObject } from "cloudflare:test";
import { getAgentByName, routeAgentRequest } from "agents";
import { McpConnectAgent } from "../../src/mcp/agent.js";

const SESSION_ID = "6f1f0c3a-8e21-4c0d-9f3b-2a7c5d8e1b04";
const AGENT_NAME = `streamable-http:${SESSION_ID}`;
const AUTH_TOKEN = "sk-live-chittyconnect-runtime-contract-test";
const BASE_URL = "https://connect.chitty.cc";

/**
 * Start the DO exactly the way McpAgent.serve() does — getAgentByName with
 * props — then return a stub for the same id so runInDurableObject can look
 * at the live instance.
 */
async function startAgentWithProps(name, props) {
  await getAgentByName(env.MCP_AGENT, name, { props });
  return env.MCP_AGENT.get(env.MCP_AGENT.idFromName(name));
}

describe("McpConnectAgent runtime contracts (agents SDK)", () => {
  it("delivers props to init(), with authToken intact", async () => {
    const stub = await startAgentWithProps(AGENT_NAME, {
      baseUrl: BASE_URL,
      authToken: AUTH_TOKEN,
    });

    await runInDurableObject(stub, (instance) => {
      // props landed where init() reads them, under that name.
      expect(instance.props?.authToken).toBe(AUTH_TOKEN);
      expect(instance.props?.baseUrl).toBe(BASE_URL);

      // ...and init() actually saw them. `this.props?.authToken` optional-chains,
      // so props arriving after init() would leave this false with no error,
      // and tool-dispatcher.js would then omit the Authorization header.
      expect(instance.initProbe).toBeDefined();
      expect(instance.initProbe.authTokenPresent).toBe(true);
      expect(instance.initProbe.baseUrl).toBe(BASE_URL);
    });
  });

  it("GET /session returns a usable sessionId and transport type", async () => {
    const stub = await startAgentWithProps(AGENT_NAME, {
      baseUrl: BASE_URL,
      authToken: AUTH_TOKEN,
    });

    const res = await stub.fetch("https://mcp-agent.invalid/session");
    expect(res.status).toBe(200);

    const body = await res.json();
    // getSessionId() derives this from the DO name; a change in that
    // derivation would orphan live sessions across a deploy, because the
    // chitty://memory/session/{id} resource addresses the DO by this id.
    expect(body.sessionId).toBe(SESSION_ID);
    expect(body.transport).toBe("streamable-http");
    expect(body.active).toBe(false);
  });

  it("serve() returns a fetch handler that accepts an MCP initialize", async () => {
    const handler = McpConnectAgent.serve("/mcp", { binding: "MCP_AGENT" });
    expect(typeof handler.fetch).toBe("function");

    const res = await SELF.fetch("https://connect.chitty.cc/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "chittyconnect-runtime-test", version: "1.0.0" },
        },
      }),
    });

    // Not 404 (path not matched), not 426 (transport refused), not 500.
    expect(res.status).toBe(200);
    expect(res.headers.get("mcp-session-id")).toBeTruthy();
    // The body is an SSE stream; reading it would hang until the timeout.
    await res.body?.cancel();
  });

  it("routeAgentRequest returns a non-Response for a non-agent path", async () => {
    // src/index.js:2332 tests the result with `instanceof Response` to decide
    // whether to fall through to the OAuth provider. If an unmatched path
    // started returning a Response, /authorize and friends would silently
    // disappear into the agent router.
    const missed = await routeAgentRequest(
      new Request("https://connect.chitty.cc/authorize"),
      env,
    );
    expect(missed instanceof Response).toBe(false);

    // Positive control: without this, an always-undefined router would pass.
    const matched = await routeAgentRequest(
      new Request(`https://connect.chitty.cc/agents/mcp-agent/${AGENT_NAME}`),
      env,
    );
    expect(matched instanceof Response).toBe(true);
  });
});
