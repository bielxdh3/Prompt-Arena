import { describe, expect, it } from "vitest";
import {
  arenaExportCsv,
  arenaExportJson,
  arenaExportMarkdown,
  buildBlindArenaCards,
  executeArena,
  summarizeArenaExecutions,
} from "./arena-runner";
import type { BenchmarkVersion, PersistedExecution, ProfileRevision } from "./bridge";

const version: BenchmarkVersion = {
  summary: {
    versionId: "bench@1",
    benchmarkId: "bench",
    versionNumber: 1,
    contentHash: "a".repeat(64),
    createdAt: "2026-01-01T00:00:00Z",
  },
  documentJson: JSON.stringify({
    schemaVersion: 1,
    kind: "benchmark",
    pack: { packId: "pack", name: "Pack", categories: [] },
    benchmark: { benchmarkId: "bench", name: "Bench" },
    benchmarkVersion: {
      versionId: "bench@1",
      versionNumber: 1,
      defaultRepetitions: 1,
      tasks: [{
        taskId: "task",
        prompt: "Answer",
        cases: [{ caseId: "case", prompt: "Now", expected: "yes", artifacts: [] }],
        rubricId: "rubric",
      }],
      rubrics: [{ rubricId: "rubric", name: "Rubric", criteria: [{ criterionId: "c", name: "C", description: "C", weight: 1 }] }],
    },
  }),
};

const profile = (id: string): ProfileRevision => ({
  profileId: id,
  profileRevisionId: `${id}@1`,
  revision: 1,
  model: id,
  runtime: "ollama",
  parameters: {},
  systemPrompt: "System",
});

function execution(runId: string, profileId: string, status: "completed" | "failed"): PersistedExecution {
  return {
    run: { runId, benchmarkVersionId: "bench@1", profileRevisionIds: [profileId], status, startedAt: "2026-01-01T00:00:00Z", attemptIds: [`${runId}-attempt`], environment: {} },
    attempt: {
      attemptId: `${runId}-attempt`,
      runId,
      profileRevisionId: profileId,
      caseId: "case",
      status,
      effectiveConfig: {},
      result: status === "completed" ? { resultId: `${runId}-result`, contentHash: "b".repeat(64), artifact: { artifactId: "a", relativePath: "runs/a.json", schemaVersion: 1, sha256: "b".repeat(64) }, score: { passed: true } } : null,
      artifacts: [],
      responseSummary: status === "completed" ? { model: profileId, finishReason: "stop", responseTextByteCount: 2, toolCallCount: 0, usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, timing: { totalDurationNs: 1_000_000, loadDurationNs: null, promptEvalDurationNs: null, evalDurationNs: 1_000_000 } } : undefined,
    },
    progress: [],
    saveOutcome: "saved",
  };
}

describe("arena runner", () => {
  it("executes repetitions sequentially and isolates a failed competitor", async () => {
    const calls: string[] = [];
    const results = await executeArena({ arenaId: "arena", version, taskId: "task", caseId: "case", profiles: [profile("one"), profile("two")], repetitions: 3 }, async (plan) => {
      calls.push(plan.profileRevision.profileRevisionId);
      if (plan.profileRevision.profileId === "two") throw new Error("model unavailable");
      return execution(plan.runId, plan.profileRevision.profileRevisionId, "completed");
    });
    expect(results).toHaveLength(6);
    expect(calls).toEqual(["one@1", "one@1", "one@1", "two@1", "two@1", "two@1"]);
    expect(results.filter((item) => item.error)).toHaveLength(3);
    expect(summarizeArenaExecutions(results)).toMatchObject({ total: 6, completed: 3, failed: 3, objectivePassed: 3 });
  });

  it("supports cancelling queued work without losing completed evidence", async () => {
    let keepRunning = true;
    const results = await executeArena({ arenaId: "arena", version, taskId: "task", caseId: "case", profiles: [profile("one"), profile("two")], repetitions: 1 }, async (plan) => {
      keepRunning = false;
      return execution(plan.runId, plan.profileRevision.profileRevisionId, "completed");
    }, undefined, () => keepRunning);
    expect(results).toHaveLength(2);
    expect(results[0].execution?.attempt.status).toBe("completed");
    expect(results[1].cancelled).toBe(true);
  });

  it("isolates a competitor whose plan cannot be built", async () => {
    const results = await executeArena({
      arenaId: "arena",
      version,
      taskId: "task",
      caseId: "case",
      profiles: [profile("one"), { ...profile("two"), parameters: { unsupported: true } }],
      repetitions: 1,
    }, async (plan) => execution(plan.runId, plan.profileRevision.profileRevisionId, "completed"));
    expect(results).toHaveLength(2);
    expect(results[0].execution?.attempt.status).toBe("completed");
    expect(results[1].execution).toBeNull();
    expect(results[1].plan).toBeNull();
    expect(results[1].error).toContain("unsupported");
  });

  it("exports metadata and keeps blind cards anonymous", () => {
    const request = { arenaId: "arena", version, taskId: "task", caseId: "case", profiles: [profile("one"), profile("two")], repetitions: 1 };
    const results = [
      { competitorId: "one@1", competitorLabel: "one", repetition: 1, runId: "arena-1-1", plan: {} as never, execution: execution("arena-1-1", "one@1", "completed"), error: null, cancelled: false },
      { competitorId: "two@1", competitorLabel: "two", repetition: 1, runId: "arena-2-1", plan: {} as never, execution: execution("arena-2-1", "two@1", "completed"), error: null, cancelled: false },
    ];
    const responses = new Map([["arena-1-1:arena-1-1-attempt", "one response"], ["arena-2-1:arena-2-1-attempt", "two response"]]);
    const cards = buildBlindArenaCards(results, responses);
    expect(cards.map((card) => card.label)).toEqual(["Response A", "Response B"]);
    expect(cards[0]).not.toHaveProperty("competitorLabel");
    expect(arenaExportJson(request, results)).not.toContain("runs/");
    expect(arenaExportMarkdown(request, results)).toContain("Competitor");
    expect(arenaExportCsv(results)).toContain("profileRevisionId");
  });
});
