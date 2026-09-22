import { WorkerEntrypoint } from "cloudflare:workers";
import { createIssueWithGitHubApp } from "./issue-authority.js";

/**
 * Private GitHub issue broker RPC surface.
 *
 * This class is reachable only through an explicit Cloudflare service binding
 * to the named WorkerEntrypoint. There is no public HTTP route for issue writes.
 */
export class GitHubIssueBrokerService extends WorkerEntrypoint {
  async createIssue(input) {
    return createIssueWithGitHubApp(this.env, input);
  }
}
