import fetch from "node-fetch";

async function run() {
  const apiKey = process.env['INPUT_API_KEY'];

  const res = await fetch("https://connect.chitty.cc/credentials/deploy", {
    headers: { "Authorization": `Bearer ${apiKey}` }
  });

  if (!res.ok) {
    throw new Error(`Chitty creds fetch failed: ${res.status}`);
  }

  const data = await res.json();

  console.log(`::set-output name=github_token::${data.github_token}`);
  console.log(`::set-output name=npm_token::${data.npm_token}`);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
