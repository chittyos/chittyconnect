import { describe, it, expect, vi, beforeEach } from "vitest";

const neonMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
}));

vi.mock("@neondatabase/serverless", () => ({
  Client: vi.fn().mockImplementation(function MockClient() {
    return {
      connect: neonMocks.connect,
      query: neonMocks.query,
      end: neonMocks.end,
    };
  }),
}));

import { Client } from "@neondatabase/serverless";
import { executeNeonQuery } from "../../src/api/routes/thirdparty.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("executeNeonQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    neonMocks.connect.mockReset();
    neonMocks.query.mockReset();
    neonMocks.end.mockReset();
  });

  it("uses HTTP fetch for HTTPS endpoints", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ rows: [{ ok: 1 }] }),
    });

    const result = await executeNeonQuery(
      "https://neon.example/sql",
      "SELECT 1 as ok",
      [],
    );

    expect(result.rows[0].ok).toBe(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://neon.example/sql",
      expect.objectContaining({ method: "POST" }),
    );
    expect(Client).not.toHaveBeenCalled();
  });

  it("throws with upstream status for HTTP failures", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
    });

    await expect(
      executeNeonQuery("https://neon.example/sql", "SELECT 1", []),
    ).rejects.toThrow("Neon query error: 502");
  });

  it("uses Neon Client for postgresql DSN and closes connection", async () => {
    const dsn = "postgresql://user:pass@ep-test.us-east-2.aws.neon.tech/db";
    neonMocks.connect.mockResolvedValue(undefined);
    neonMocks.query.mockResolvedValue({ rows: [{ ok: 1 }] });
    neonMocks.end.mockResolvedValue(undefined);

    const result = await executeNeonQuery(dsn, "SELECT 1 as ok", []);

    expect(result.rows[0].ok).toBe(1);
    expect(Client).toHaveBeenCalledWith({ connectionString: dsn });
    expect(neonMocks.connect).toHaveBeenCalledTimes(1);
    expect(neonMocks.query).toHaveBeenCalledWith("SELECT 1 as ok", []);
    expect(neonMocks.end).toHaveBeenCalledTimes(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
