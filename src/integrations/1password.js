import { OnePasswordConnectClient } from "../services/1password-connect-client.js";

/**
 * Handle POST /admin/provision-secrets
 *
 * Provision or update a secret value in 1Password.
 */
export async function handleProvisionSecretsRoute(request, env) {
  try {
    const body = await request.json();
    const { path, value, notes } = body;

    if (!path || !value) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Missing path or value in request body",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const client = new OnePasswordConnectClient(env);
    const result = await client.put(path, value, { notes });

    return new Response(JSON.stringify({ success: true, ...result }), {
      status: result.action === "created" ? 201 : 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[1Password Provision Route] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * Handle GET /secrets/*
 *
 * Direct retrieval of a secret by path from 1Password Connect.
 */
export async function handleDirectFetchRoute(request, env) {
  try {
    const url = new URL(request.url);
    const secretPath = url.pathname.replace(/^\/secrets\//, "");

    if (!secretPath) {
      return new Response(
        JSON.stringify({ success: false, error: "Missing secret path" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const client = new OnePasswordConnectClient(env);
    const value = await client.get(secretPath);

    return new Response(
      JSON.stringify({ success: true, value, path: secretPath }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[1Password Direct Fetch] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
