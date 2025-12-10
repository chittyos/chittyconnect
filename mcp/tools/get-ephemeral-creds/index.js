import fetch from "node-fetch";

export async function run(args, env) {
  const apiKey = args.api_key;

  const res = await fetch("https://connect.chitty.cc/credentials/deploy", {
    headers: { Authorization: `Bearer ${apiKey}` }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return await res.json();
}
