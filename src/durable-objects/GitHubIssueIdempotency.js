import { processIdempotentIssueCreate } from "../github/issue-authority.js";

/**
 * One Durable Object instance per GitHub (repo,idempotency_key) digest.
 *
 * The durable reservation is written before any external side effect. A hidden
 * marker in the GitHub issue body provides reconciliation if GitHub commits the
 * issue but the final Durable Object receipt write fails.
 */
export class GitHubIssueIdempotency {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.inFlight = null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/create") {
      return Response.json({ ok: false, status: 404, code: "NOT_FOUND" }, { status: 404 });
    }

    const operation = await request.json().catch(() => null);
    if (
      !operation ||
      typeof operation.digest !== "string" ||
      typeof operation.request_hash !== "string" ||
      typeof operation.repo !== "string"
    ) {
      return Response.json(
        {
          ok: false,
          status: 400,
          code: "INVALID_OPERATION",
          retryable: false,
          error: "normalized GitHub issue operation required",
        },
        { status: 400 },
      );
    }

    if (this.inFlight) {
      if (this.inFlight.requestHash !== operation.request_hash) {
        return Response.json(
          {
            ok: false,
            status: 409,
            code: "IDEMPOTENCY_CONFLICT",
            retryable: false,
            error: "idempotency_key is already executing with a different payload",
          },
          { status: 409 },
        );
      }
      const shared = await this.inFlight.promise;
      return Response.json(shared, { status: shared.status || 200 });
    }

    const promise = processIdempotentIssueCreate(
      this.state.storage,
      this.env,
      operation,
    ).finally(() => {
      this.inFlight = null;
    });
    this.inFlight = { requestHash: operation.request_hash, promise };

    const result = await promise;
    return Response.json(result, { status: result.status || (result.ok ? 200 : 500) });
  }
}
