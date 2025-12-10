import { writeFileSync } from "fs";

async function run() {
  try {
    const apiKey = process.env["INPUT_API_KEY"];
    if (!apiKey) {
      throw new Error("INPUT_API_KEY is missing. Did you pass 'api_key:' in the workflow?");
    }

    const res = await (globalThis.fetch || (await import('node-fetch')).default)("https://connect.chitty.cc/credentials/deploy", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Chitty creds fetch failed: HTTP ${res.status}\n${text}`);
    }

    const data = await res.json();

    // GitHub's required output method
    const outputPath = process.env.GITHUB_OUTPUT;
    if (!outputPath) {
      throw new Error("GITHUB_OUTPUT environment variable is missing.");
    }

    writeFileSync(outputPath, `github_token=${data.github_token}\n`, { flag: "a" });
    writeFileSync(outputPath, `npm_token=${data.npm_token}\n`, { flag: "a" });

    console.log("Ephemeral credentials retrieved and exported successfully.");

  } catch (err) {
    console.error("❌ ChittyConnect credentials action failed:");
    console.error(err);
    process.exit(1);
  }
}

run();
