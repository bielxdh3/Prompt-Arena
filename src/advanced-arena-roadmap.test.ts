import { describe, expect, it } from "vitest";
import { advancedEvidenceSummary } from "./advanced-arena-roadmap";

describe("advanced arena evidence boundary", () => {
  it("summarizes only terminal persisted samples", () => {
    const summary = advancedEvidenceSummary({
      arenaId: "arena", benchmarkVersionId: "logic@1", taskId: "logic", caseId: "case", repetitions: 1,
      packId: null, materializationSeed: null, arenaWallTimeMs: null, summary: {}, competitors: [], contentHash: "h", createdAt: "2026-09-12T00:00:00Z", evidence: [
        { competitorId: "a", competitorLabel: "A", repetition: 1, runId: "r", attemptId: "a", status: "completed", durationMs: 1, loadDurationMs: null, generationDurationMs: null, ttftMs: null, promptTokens: null, tokensPerSecond: null, completionTokens: null, totalTokens: null, objectivePassed: true },
      ],
    });
    expect(summary).toEqual({ samples: 1, completed: 1, failed: 0 });
  });
});
