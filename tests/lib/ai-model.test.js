/**
 * Tests for Workers AI model resolution.
 *
 * The envelopes below are not hand-written fixtures — they are the verbatim
 * payloads returned by production Workers AI on 2026-09-04 via
 * POST https://connect.chitty.cc/api/thirdparty/cloudflare/ai/run, recorded so
 * the parser is exercised against the shape the platform actually emits rather
 * than the shape we assume it emits.
 */

import { describe, it, expect } from "vitest";
import {
  AI_MODEL_DEFAULT,
  resolveAiModel,
  extractAiText,
} from "../../src/lib/ai-model.js";

// Recorded live: model "@cf/meta/llama-4-scout-17b-16e-instruct", prompt "reply with the word ok"
const LIVE_SCOUT_ENVELOPE = {
  choices: [
    {
      finish_reason: "stop",
      index: 0,
      logprobs: null,
      message: {
        annotations: null,
        audio: null,
        content: "ok",
        function_call: null,
        reasoning: null,
        refusal: null,
        role: "assistant",
      },
      routed_experts: null,
      stop_reason: null,
      token_ids: null,
    },
  ],
  created: 1788561543,
  id: "chatcmpl-a318096f-ca2c-423a-a8bc-4813ca68c36f",
  model: "@cf/meta/llama-4-scout-17b-16e-instruct",
  object: "chat.completion",
  response: "ok",
  tool_calls: [],
  usage: { prompt_tokens: 15, completion_tokens: 2, total_tokens: 17 },
};

describe("resolveAiModel", () => {
  it("defaults to a model that is live in production, not the 2026-05-30 deprecated one", () => {
    expect(resolveAiModel({})).toBe(AI_MODEL_DEFAULT);
    expect(AI_MODEL_DEFAULT).not.toContain("llama-3.1-8b-instruct");
  });

  it("honours the AI_MODEL_PRIMARY override so the next deprecation needs no code change", () => {
    expect(
      resolveAiModel({
        AI_MODEL_PRIMARY: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      }),
    ).toBe("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  });

  it("tolerates a missing env rather than throwing inside a catch-wrapped AI path", () => {
    expect(resolveAiModel(undefined)).toBe(AI_MODEL_DEFAULT);
  });
});

describe("extractAiText", () => {
  it("reads the live production envelope", () => {
    expect(extractAiText(LIVE_SCOUT_ENVELOPE)).toBe("ok");
  });

  it("still reads the envelope when the compat `response` field is absent", () => {
    const { response: _dropped, ...choicesOnly } = LIVE_SCOUT_ENVELOPE;
    expect(extractAiText(choicesOnly)).toBe("ok");
  });

  it("returns empty string — never undefined — for an envelope carrying no text", () => {
    // A caller that stores undefined turns a loud failure into a silent one.
    for (const empty of [
      {},
      { choices: [] },
      { choices: [{ message: {} }] },
      null,
      7,
    ]) {
      expect(extractAiText(empty)).toBe("");
    }
  });
});
