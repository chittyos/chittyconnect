/**
 * Workers AI model resolution for the ChittyConnect intelligence layer.
 *
 * `@cf/meta/llama-3.1-8b-instruct` aliases `@cf/meta/infire-llama-3.1-8b-instruct`,
 * which Cloudflare deprecated on 2026-05-30. Calls to it fail with error 5028, so
 * every intelligence-layer AI path that hardcoded it has been silently degraded
 * since that date. Resolve the model through this module instead of inlining an id,
 * so the next deprecation is a single env var away from being handled.
 */

export const AI_MODEL_DEFAULT = "@cf/meta/llama-4-scout-17b-16e-instruct";

/**
 * @param {{AI_MODEL_PRIMARY?: string}} env
 * @returns {string} model id to pass to env.AI.run()
 */
export function resolveAiModel(env) {
  return env?.AI_MODEL_PRIMARY || AI_MODEL_DEFAULT;
}

/**
 * Workers AI returns a chat-completions envelope that carries the generated text
 * both as a top-level `response` string and under `choices[0].message.content`.
 * Read both so a model whose envelope omits either shape does not degrade to
 * `undefined` — an undefined summary is a silent failure, which is worse than the
 * loud one it would replace.
 *
 * @param {unknown} result value returned by env.AI.run()
 * @returns {string} generated text, or "" when the envelope carries none
 */
export function extractAiText(result) {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return "";
  if (typeof result.response === "string") return result.response;
  const choice = Array.isArray(result.choices) ? result.choices[0] : null;
  const content = choice?.message?.content;
  return typeof content === "string" ? content : "";
}
