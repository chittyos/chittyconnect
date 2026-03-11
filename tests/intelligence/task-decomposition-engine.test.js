import { describe, it, expect, beforeEach } from "vitest";
import { TaskDecompositionEngine } from "../../src/intelligence/task-decomposition-engine.js";

describe("TaskDecompositionEngine", () => {
  let engine;

  beforeEach(async () => {
    engine = new TaskDecompositionEngine({});
    await engine.initialize();
  });

  it("decomposes a complex task into subtasks, graph edges, and stages", async () => {
    const result = await engine.decompose(
      "Analyze requirements, implement API endpoint, test behavior, deploy to production, and document rollout notes.",
      { requireDocumentation: true },
    );

    expect(result.graph.nodes.length).toBeGreaterThanOrEqual(4);
    expect(result.graph.edges.length).toBeGreaterThan(0);
    expect(result.stages.length).toBeGreaterThan(0);
    expect(result.metrics.subtaskCount).toBe(result.graph.nodes.length);
    expect(result.criticalPath.taskIds.length).toBeGreaterThan(0);
  });

  it("returns deterministic fallback decomposition for sparse tasks", async () => {
    const result = await engine.decompose("fix it");

    expect(result.graph.nodes.length).toBeGreaterThanOrEqual(3);
    expect(result.graph.nodes.some((n) => n.kind === "analysis")).toBe(true);
    expect(result.graph.nodes.some((n) => n.kind === "validation")).toBe(true);
  });

  it("throws when task input is missing", async () => {
    await expect(engine.decompose("")).rejects.toThrow("task is required");
  });
});
