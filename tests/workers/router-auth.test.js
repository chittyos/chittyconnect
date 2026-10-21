/**
 * Router-level auth: every /api/* route sits behind `authenticate`, mounted
 * once in src/api/router.js (`api.use("/api/*", authenticate)`). This test
 * drives the real router, so dropping that mount fails it. It runs in the
 * Workers pool because the router cannot be imported under Node.
 */
import { describe, it, expect } from "vitest";
import { api } from "../../src/api/router.js";

const executionCtx = { waitUntil() {}, passThroughOnException() {} };

describe("api router auth", () => {
  it("rejects an unauthenticated GitHub proxy request with 401", async () => {
    const res = await api.fetch(
      new Request(
        "https://connect.chitty.cc/api/thirdparty/github/repos/chittyos/x/pulls/1",
      ),
      {},
      executionCtx,
    );
    expect(res.status).toBe(401);
  });
});
