/**
 * Forward GitHub `check_suite` `completed` events to chittyagent-autoassist.
 *
 * autoassist's pr_land_v1 loop pauses on a `github_check_suite_completed`
 * event for the PR's new head. This module delivers that event to
 * `POST /api/v1/loops/events` over the SVC_AUTOASSIST service binding.
 *
 * It runs from the GitHub event queue consumer, so the webhook's HMAC
 * signature has already been verified before anything here executes.
 *
 * Per-PR retry state lives in IDEMP_KV (`fwd:<delivery>:<correlation_key>`,
 * 1 day TTL). A PR whose event got a 2xx or 4xx is recorded, so a retry of the
 * same delivery re-sends only the PRs that failed.
 *
 * Never throws. A missing binding or token, or a 4xx reply (e.g. 404 when no
 * loop is waiting on that PR), is logged and the message is acked. A 5xx reply
 * or a failed fetch sets `retry: true`, and the queue consumer retries the
 * message (the queue's max_retries bounds this).
 */

import { resolveBindingValue } from "../lib/credential-helper.js";

export const LOOP_EVENT_TYPE = "github_check_suite_completed";
export const LOOP_EVENTS_PATH = "/api/v1/loops/events";

/**
 * Build one loop event per pull request attached to the check suite.
 * `check_suite.pull_requests` is empty for PRs from forks, so those
 * produce no events.
 *
 * @param {object} payload - GitHub check_suite webhook payload
 * @param {Array|null} checkRuns - Summarized check runs for the head sha
 * @returns {Array<object>} Request bodies for /api/v1/loops/events
 */
export function buildCheckSuiteLoopEvents(payload, checkRuns) {
  const suite = payload?.check_suite;
  const fullName = payload?.repository?.full_name;
  if (!suite || !fullName) return [];

  return (suite.pull_requests || [])
    .filter((pr) => Number.isInteger(pr?.number))
    .map((pr) => ({
      type: LOOP_EVENT_TYPE,
      correlation_key: `${fullName}#${pr.number}`,
      payload: {
        head_sha: suite.head_sha,
        conclusion: suite.conclusion,
        check_runs: checkRuns,
      },
    }));
}

const FORWARDED_TTL_SECONDS = 86400;

const forwardedKey = (delivery, correlationKey) =>
  `fwd:${delivery}:${correlationKey}`;

const GITHUB_API_ORIGIN = "https://api.github.com";

function isGitHubApiUrl(url) {
  try {
    return new URL(url).origin === GITHUB_API_ORIGIN;
  } catch {
    return false;
  }
}

async function fetchCheckRunSummary(token, checkRunsUrl) {
  if (!token || !checkRunsUrl) return null;
  // The installation token goes only to GitHub's API, never to a payload URL
  // that points anywhere else.
  if (!isGitHubApiUrl(checkRunsUrl)) {
    console.warn(
      "[check-suite] check_runs_url not on api.github.com; skipped",
      {
        check_runs_url: checkRunsUrl,
      },
    );
    return null;
  }
  try {
    const res = await fetch(checkRunsUrl, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ChittyConnect/1.0",
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.check_runs || []).map((run) => ({
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
    }));
  } catch {
    return null;
  }
}

/**
 * @param {object} env - Worker environment (SVC_AUTOASSIST, AUTOASSIST_ADMIN_TOKEN)
 * @param {object} payload - GitHub check_suite webhook payload
 * @param {string} [token] - GitHub installation token for the check-runs read
 * @param {string} [delivery] - GitHub delivery id; enables per-PR retry state
 * @returns {Promise<{forwarded: number, skipped?: string, results?: Array, retry?: boolean}>}
 */
export async function forwardCheckSuiteCompleted(
  env,
  payload,
  token,
  delivery,
) {
  if (payload?.action !== "completed") {
    return { forwarded: 0, skipped: "action_not_completed" };
  }

  const binding = env.SVC_AUTOASSIST;
  if (!binding || typeof binding.fetch !== "function") {
    console.warn("[check-suite] SVC_AUTOASSIST binding missing; not forwarded");
    return { forwarded: 0, skipped: "binding_missing" };
  }

  const adminToken = await resolveBindingValue(env.AUTOASSIST_ADMIN_TOKEN);
  if (!adminToken) {
    console.error("[check-suite] AUTOASSIST_ADMIN_TOKEN unset; not forwarded", {
      code: "POLICY_BLOCKED_AUTOASSIST_TOKEN_UNSET",
    });
    return { forwarded: 0, skipped: "token_missing" };
  }

  const preview = buildCheckSuiteLoopEvents(payload, null);
  if (preview.length === 0) {
    return { forwarded: 0, skipped: "no_pull_requests" };
  }

  const checkRuns = await fetchCheckRunSummary(
    token,
    payload.check_suite.check_runs_url,
  );
  const allEvents = buildCheckSuiteLoopEvents(payload, checkRuns);

  // Skip PRs a previous attempt of this delivery already settled.
  const events = [];
  for (const event of allEvents) {
    let settled = null;
    if (delivery && env.IDEMP_KV) {
      try {
        settled = await env.IDEMP_KV.get(
          forwardedKey(delivery, event.correlation_key),
        );
      } catch (error) {
        console.warn("[check-suite] settled-state read failed", {
          correlation_key: event.correlation_key,
          error: error.message,
        });
      }
    }
    if (!settled) events.push(event);
  }
  if (events.length === 0) {
    return { forwarded: 0, skipped: "already_forwarded" };
  }

  const results = await Promise.all(
    events.map(async (event) => {
      try {
        const res = await binding.fetch(
          new Request(`https://chittyagent-autoassist${LOOP_EVENTS_PATH}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${adminToken}`,
              "X-Source-Service": "chittyconnect",
            },
            body: JSON.stringify(event),
          }),
        );
        if (!res.ok) {
          console.warn("[check-suite] autoassist did not accept event", {
            correlation_key: event.correlation_key,
            status: res.status,
          });
        }
        if (res.status < 500 && delivery && env.IDEMP_KV) {
          try {
            await env.IDEMP_KV.put(
              forwardedKey(delivery, event.correlation_key),
              "done",
              { expirationTtl: FORWARDED_TTL_SECONDS },
            );
          } catch (error) {
            console.warn("[check-suite] settled-state write failed", {
              correlation_key: event.correlation_key,
              error: error.message,
            });
          }
        }
        return { correlation_key: event.correlation_key, status: res.status };
      } catch (error) {
        console.warn("[check-suite] forward failed", {
          correlation_key: event.correlation_key,
          error: error.message,
        });
        return { correlation_key: event.correlation_key, error: error.message };
      }
    }),
  );

  return {
    forwarded: results.filter((r) => r.status >= 200 && r.status < 300).length,
    results,
    retry: results.some((r) => r.error !== undefined || r.status >= 500),
  };
}
