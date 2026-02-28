import { describe, it, expect } from "vitest";
import {
  deriveToolErrorStatus,
  resolveInternalBaseUrl,
} from "../../src/api/routes/mcp.js";

describe("deriveToolErrorStatus", () => {
  it("returns 400 for unknown tool errors", () => {
    expect(
      deriveToolErrorStatus({
        isError: true,
        content: [{ type: "text", text: "Unknown tool: does_not_exist" }],
      }),
    ).toBe(400);
  });

  it("returns 403 for permission denied errors", () => {
    expect(
      deriveToolErrorStatus({
        isError: true,
        content: [{ type: "text", text: "Permission denied: trust level too low" }],
      }),
    ).toBe(403);
  });

  it("returns 401 for authentication errors", () => {
    expect(
      deriveToolErrorStatus({
        isError: true,
        content: [{ type: "text", text: "Authentication required: missing token" }],
      }),
    ).toBe(401);
  });

  it("returns 429 for rate limit errors", () => {
    expect(
      deriveToolErrorStatus({
        isError: true,
        content: [{ type: "text", text: "Rate limit exceeded" }],
      }),
    ).toBe(429);
  });

  it("extracts and returns upstream HTTP status from message", () => {
    expect(
      deriveToolErrorStatus({
        isError: true,
        content: [{ type: "text", text: "Neon error (502): Bad Gateway" }],
      }),
    ).toBe(502);
  });

  it("defaults to 500 when no status can be inferred", () => {
    expect(
      deriveToolErrorStatus({
        isError: true,
        content: [{ type: "text", text: "Unexpected tool execution failure" }],
      }),
    ).toBe(500);
  });
});

describe("resolveInternalBaseUrl", () => {
  it("rewrites mcp subdomain to connect for internal API calls", () => {
    expect(resolveInternalBaseUrl("https://mcp.chitty.cc/mcp/tools/call")).toBe(
      "https://connect.chitty.cc",
    );
  });

  it("keeps connect subdomain unchanged", () => {
    expect(
      resolveInternalBaseUrl("https://connect.chitty.cc/mcp/tools/call"),
    ).toBe("https://connect.chitty.cc");
  });
});
