export async function generateEphemeralCreds(apiKey, env) {
  const res = await fetch("https://connect.chitty.cc/credentials/deploy", {
    headers: { Authorization: `Bearer ${apiKey}` }
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  return {
    github_token: data.github_token,
    npm_token: data.npm_token
  };
}
import { generateEphemeralCreds } from "./services/creds.js";

export async function executeTool(name, args, env) {
  if (name === "get_ephemeral_credentials") {
    return await generateEphemeralCreds(args.api_key, env);
  }

  // existing tools…
}

