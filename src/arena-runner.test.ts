import { describe, expect, it } from "vitest";
import {
  arenaExportCsv,
  arenaExportJson,
  arenaExportMarkdown,
  buildBlindArenaCards,
  executeArena,
  rankArenaCompetitors,
  summarizeArenaCompetitors,
  summarizeArenaExecutions,
  applyArenaProgress,
  arenaTelemetryLabel,
  createArenaTelemetry,
  visibleArenaTelemetryMetrics,
  type ArenaProgress,
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
    expect(summarizeArenaExecutions(results)).toMatchObject({ total: 6, completed: 3, failed: 3, objectivePassed: 3, successRate: 0.5 });
    expect(summarizeArenaCompetitors(results)).toEqual(expect.arrayContaining([
      expect.objectContaining({ competitorId: "one@1", completed: 3, successRate: 1 }),
      expect.objectContaining({ competitorId: "two@1", failed: 3, successRate: 0 }),
    ]));
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
    const request = { arenaId: "arena", version, taskId: "task", caseId: "case", profiles: [{ ...profile("one"), parameters: { temperature: 0.2, apiKey: "must-not-export" } }, profile("two")], repetitions: 1 };
    const results = [
      { competitorId: "one@1", competitorLabel: "one", repetition: 1, runId: "arena-1-1", plan: {} as never, execution: execution("arena-1-1", "one@1", "completed"), error: null, cancelled: false },
      { competitorId: "two@1", competitorLabel: "two", repetition: 1, runId: "arena-2-1", plan: {} as never, execution: execution("arena-2-1", "two@1", "completed"), error: null, cancelled: false },
    ];
    const responses = new Map([["arena-1-1:arena-1-1-attempt", "one response"], ["arena-2-1:arena-2-1-attempt", "two response"]]);
    const cards = buildBlindArenaCards(results, responses);
    expect(cards.map((card) => card.label)).toEqual(["Response A", "Response B"]);
    expect(cards[0]).not.toHaveProperty("competitorLabel");
    expect(arenaExportJson(request, results)).not.toContain("runs/");
    expect(arenaExportJson(request, results)).not.toContain("must-not-export");
    expect(arenaExportMarkdown(request, results)).toContain("Competitor");
    expect(arenaExportCsv(results)).toContain("profileRevisionId");
  });

  it("ranks by explicit human scores and falls back to objective pass rate", () => {
    const results = [
      { competitorId: "one@1", competitorLabel: "one", repetition: 1, runId: "arena-1-1", plan: {} as never, execution: execution("arena-1-1", "one@1", "completed"), error: null, cancelled: false },
      { competitorId: "two@1", competitorLabel: "two", repetition: 1, runId: "arena-2-1", plan: {} as never, execution: execution("arena-2-1", "two@1", "completed"), error: null, cancelled: false },
    ];
    const ranking = rankArenaCompetitors(results, new Map([
      ["arena-1-1:arena-1-1-attempt", 5],
      ["arena-2-1:arena-2-1-attempt", 2],
    ]));
    expect(ranking[0]).toMatchObject({ rank: 1, competitorId: "one@1", metric: "human_average_score", value: 5, sampleSize: 1 });
    expect(rankArenaCompetitors(results)[0].metric).toBe("objective_pass_rate");
  });

  it("tracks progress transitions, measured accumulation, token rate, and deterministic ETA", () => {
    const request = { arenaId: "arena", version, taskId: "task", caseId: "case", profiles: [profile("one"), profile("two")], repetitions: 3 };
    let clock = 1000;
    const progress: ArenaProgress[] = [];
    const resultsPromise = executeArena(request, async (plan) => {
      clock += 100;
      return execution(plan.runId, plan.profileRevision.profileRevisionId, "completed");
    }, (event) => progress.push(event), () => true, () => clock);
    return resultsPromise.then((results) => {
      let telemetry = createArenaTelemetry(request, 1000);
      for (const event of progress) telemetry = applyArenaProgress(telemetry, event);
      expect(progress.map((event) => event.status)).toContain("preparing");
      expect(progress.map((event) => event.status)).toContain("generating");
      expect(progress.at(-1)?.status).toBe("completed");
      expect(telemetry.completed).toBe(6);
      expect(telemetry.samples[0].durationMs).toBe(1);
      expect(telemetry.etaMs).toBe(0);
      expect(telemetry.samples[0].metrics.tokensPerSecond).toBe(1000);
      expect(telemetry.samples[0].metrics.generationDurationMs).toBe(1);
      expect(telemetry.samples[0].metrics.loadDurationMs).toBeNull();
      expect(results).toHaveLength(6);
    });
  });

  it("keeps blind telemetry neutral and hides identity-sensitive metrics", () => {
    const request = { arenaId: "arena", version, taskId: "task", caseId: "case", profiles: [profile("one"), profile("two")], repetitions: 1 };
    const telemetry = createArenaTelemetry(request, 10);
    expect(arenaTelemetryLabel(telemetry.samples[0], true)).toBe("Competitor A");
    expect(arenaTelemetryLabel(telemetry.samples[1], true)).toBe("Competitor B");
    expect(visibleArenaTelemetryMetrics({ loadDurationMs: 1, ttftMs: 2, generationDurationMs: 3, promptTokens: 4, completionTokens: 5, totalTokens: 9, tokensPerSecond: 6, authoritative: true }, true)).toEqual({ loadDurationMs: null, ttftMs: null, generationDurationMs: null, promptTokens: null, completionTokens: null, totalTokens: null, tokensPerSecond: null, authoritative: false });
  });

  it("records cancellation and sanitized failure without weakening sequential continuation", async () => {
    let keepRunning = true;
    const events: ArenaProgress[] = [];
    const results = await executeArena({ arenaId: "arena", version, taskId: "task", caseId: "case", profiles: [profile("one"), profile("two")], repetitions: 1 }, async () => {
      keepRunning = false;
      throw new Error("authorization bearer secret");
    }, (event) => events.push(event), () => keepRunning, () => 100);
    expect(results[0].error).toBe("Execution failed; details withheld.");
    expect(results[1].cancelled).toBe(true);
    expect(events.map((event) => event.status)).toEqual(expect.arrayContaining(["failed", "cancelled"]));
  });

  it("recovers from a rejected execution invoke before the next sample", async () => {
    const results = await executeArena({ arenaId: "arena", version, taskId: "task", caseId: "case", profiles: [profile("one"), profile("two")], repetitions: 1 }, async (plan) => {
      if (plan.profileRevision.profileId === "one") throw new Error("mock invoke failure");
      return execution(plan.runId, plan.profileRevision.profileRevisionId, "completed");
    });
    expect(results[0].error).toBe("mock invoke failure");
    expect(results[1].execution?.attempt.status).toBe("completed");
  });
});
