/**
 * Authorization gate for MCP agent_context.
 *
 * Service scope must derive from a validated API key, not tool arguments,
 * session context, X-Source-Service, or an unverified OAuth user claim.
 * This protects versioned prompts that declare allowedServices.
 */

function parseGate(raw) {
  try {
    const gate = typeof raw === "string" ? JSON.parse(raw) : raw;
    return gate && typeof gate === "object" && !Array.isArray(gate) ? gate : null;
  } catch {
    return null;
  }
}

/**
 * @returns {Promise<{ allowed: boolean, reason?: string, service?: string }>}
 */
export async function authorizeAgentContext(prompt, agentId, authToken, env) {
  const gate = parseGate(prompt?.consumer_gate);
  if (!gate) return { allowed: false, reason: "invalid consumer gate" };

  // Preserve existing behavior for older unscoped prompts. A malformed
  // explicit allowlist, however, must not silently turn into public access.
  if (!Object.hasOwn(gate, "allowedServices")) return { allowed: true };
  if (!Array.isArray(gate.allowedServices)) {
    return { allowed: false, reason: "invalid allowed services" };
  }
  if (!Array.isArray(gate.allowedAgents) && Object.hasOwn(gate, "allowedAgents")) {
    return { allowed: false, reason: "invalid allowed agents" };
  }
  if (Array.isArray(gate.allowedAgents) && gate.allowedAgents.length &&
      !gate.allowedAgents.includes(agentId)) {
    return { allowed: false, reason: "agent not permitted" };
  }

  // Wildcard services still respect an explicit agent restriction, but
  // preserve historical behavior for genuinely unscoped prompt consumers.
  if (gate.allowedServices.includes("*")) return { allowed: true };

  if (!authToken || typeof authToken !== "string" ||
      !env?.API_KEYS || typeof env.API_KEYS.get !== "function") {
    return { allowed: false, reason: "authenticated service identity required" };
  }
  let data;
  try {
    const raw = await env.API_KEYS.get("key:" + authToken);
    data = raw ? JSON.parse(raw) : null;
  } catch {
    return { allowed: false, reason: "service credential validation unavailable" };
  }
  if (data?.status !== "active" ||
      typeof data.service !== "string" || !data.service.trim() ||
      (data.expiresAt && (!Number.isFinite(Date.parse(data.expiresAt)) ||
        Date.parse(data.expiresAt) <= Date.now()))) {
    return { allowed: false, reason: "active service credential required" };
  }

  if (!gate.allowedServices.includes(data.service)) {
    return { allowed: false, reason: "consumer service not permitted" };
  }
  return { allowed: true, service: data.service };
}

/**
 * Explicit opt-in for a caller-supplied additional prompt layer.
 * Legacy unscoped prompts are readable only by their existing owners;
 * they are never composable into another agent via additional_layers.
 *
 * Cross-domain composition is denied until a separately governed scope
 * delegation exists. Storage cannot import Litigation prompts merely
 * because both records are present in the same D1 database.
 */
export async function authorizeAdditionalAgentLayer(basePrompt, layerPrompt, agentId, authToken, env) {
  if (!basePrompt || !layerPrompt ||
      typeof basePrompt.domain !== "string" ||
      basePrompt.domain !== layerPrompt.domain) {
    return { allowed: false, reason: "prompt layer domain mismatch" };
  }
  const layerGate = parseGate(layerPrompt.consumer_gate);
  if (!layerGate || !Array.isArray(layerGate.allowedServices) ||
      layerGate.allowedServices.length === 0 ||
      layerGate.allowedServices.includes("*")) {
    return { allowed: false, reason: "explicit service grant required for additional layer" };
  }
  if (!Array.isArray(layerGate.allowedAgents) ||
      !layerGate.allowedAgents.includes(agentId)) {
    return { allowed: false, reason: "explicit agent grant required for additional layer" };
  }
  const baseGate = parseGate(basePrompt.consumer_gate);
  const requiredScopes = Array.isArray(baseGate?.scopeBoundaries)
    ? baseGate.scopeBoundaries : [];
  if (requiredScopes.length > 0 &&
      (!Array.isArray(layerGate.scopeBoundaries) ||
        !requiredScopes.every(scope => layerGate.scopeBoundaries.includes(scope)))) {
    return { allowed: false, reason: "additional layer scope is incompatible" };
  }
  return authorizeAgentContext(layerPrompt, agentId, authToken, env);
}
