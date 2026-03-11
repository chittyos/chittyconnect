import { describe, it, expect, beforeEach } from "vitest";
import { IntentPredictor } from "../../src/intelligence/intent-predictor.js";

class MockMemory {
  constructor(historyByUser = {}) {
    this.historyByUser = historyByUser;
  }

  async getUserHistory(userId) {
    return this.historyByUser[userId] || [];
  }
}

describe("IntentPredictor", () => {
  let predictor;

  beforeEach(async () => {
    predictor = new IntentPredictor(
      {},
      {
        memory: new MockMemory({
          "user-evidence": [
            {
              content: "retrieve evidence and verify contradictions from ledger",
              actions: [{ type: "evidence_search" }, { type: "ledger_query" }],
              entities: [{ type: "case" }],
            },
            {
              content: "summarize evidence and proof verification outcome",
              actions: [{ type: "proof_verify" }],
              entities: [{ type: "fact" }],
            },
          ],
        }),
      },
    );
    await predictor.initialize();
  });

  it("predicts finance intent from finance-specific query", async () => {
    const prediction = await predictor.predictIntent(
      "show me balance and cash flow for this month",
      { userId: "user-x", aiRefine: false },
    );

    expect(prediction.intent.name).toBe("finance_analysis");
    expect(prediction.suggestedServices).toContain("chittyfinance");
    expect(prediction.confidence).toBeGreaterThan(0.45);
  });

  it("uses history signals to bias toward evidence analysis", async () => {
    const prediction = await predictor.predictIntent("analyze recent findings", {
      userId: "user-evidence",
      aiRefine: false,
    });

    expect(prediction.intent.name).toBe("evidence_analysis");
    expect(prediction.historySummary.available).toBe(true);
    expect(prediction.suggestedServices).toContain("chittyevidence");
  });

  it("throws when input is empty", async () => {
    await expect(predictor.predictIntent("")).rejects.toThrow("input is required");
  });

  it("returns predictor stats", async () => {
    await predictor.predictIntent("relationship between these contexts", {
      aiRefine: false,
    });
    const stats = await predictor.getStats();

    expect(stats.available).toBe(true);
    expect(stats.requests).toBe(1);
    expect(stats.intentTypes).toBeGreaterThan(3);
  });
});
