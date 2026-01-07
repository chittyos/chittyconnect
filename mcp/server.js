import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// resolves directory for dynamic imports
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load tool manifest dynamically from /mcp/tools/*
export async function loadTools() {
  const tools = {};

  const toolDir = path.join(__dirname, "tools/get-ephemeral-creds");
  const manifestPath = path.join(toolDir, "manifest.json");
  const manifestRaw = await readFile(manifestPath, "utf-8");
  const manifest = JSON.parse(manifestRaw);

  tools[manifest.name] = {
    description: manifest.description,
    inputSchema: manifest.input_schema,
    modulePath: path.join(toolDir, "index.js"),
  };

  return tools;
}

// Execute requested tool
export async function executeTool(name, args, env) {
  const tools = await loadTools();

  if (!tools[name]) {
    throw new Error(`Tool not found: ${name}`);
  }

  const mod = await import(tools[name].modulePath);

  if (!mod.run) {
    throw new Error(`Tool ${name} has no run() export`);
  }

  return await mod.run(args, env);
}
