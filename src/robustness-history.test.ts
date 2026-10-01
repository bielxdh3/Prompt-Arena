import { describe, expect, it } from "vitest";
import { compareRobustnessHistory, exportRobustnessHistoryComparison, type RobustnessHistoryRecord } from "./robustness-history";
import type { RobustnessResult } from "./robustness-arena";
import { canonicalJson } from "./roadmap-records";

function result(overrides: Partial<RobustnessResult> = {}): RobustnessResult {
  return {
    schemaVersion: 1,
    kind: "robustness_arena",
    sourceTaskVersion: "logic@1",
    taskId: "reasoning",
    caseId: "case-1",
    profileRevisionId: "profile-alpha@1",
    basePassed: true,
    baseRunId: "base-run",
    baseAttemptId: "base-attempt",
    baseEvidenceSaved: true,
    baseStatus: "completed",
    variants: [{
      transformationType: "paraphrase",
      version: "2",
      seed: 1,
      sourceTaskVersion: "logic@1",
      perturbationId: "perturb-logic-1-1",
      sourcePrompt: "Solve this.",
      prompt: "Work out this.",
      expected: "42",
      provenance: "deterministic-local/paraphrase/v2",
      passed: true,
      runId: "variant-run",
      attemptId: "variant-attempt",
      executionStatus: "completed",
    }],
    robustnessScore: 1,
    variance: 0,
    failureClusters: [],
    createdAt: "2026-09-30T12:00:00.000Z",
    ...overrides,
  };
}

function record(recordId: string, contentHash: string, value = result()): RobustnessHistoryRecord {
  return { recordId, contentHash, result: value };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("robustness history", () => {
  it("compares only the robustness score, variance, and base outcome while exposing changed conditions", () => {
    const baseline = record("robust-base", "a".repeat(64));
    const candidate = record("robust-candidate", "b".repeat(64), result({ robustnessScore: 0.5, variance: 0.25, basePassed: false }));
    const comparison = compareRobustnessHistory(baseline, candidate, "2026-09-30T13:00:00.000Z");

    expect(comparison).toMatchObject({
      kind: "robustness_historical_comparison",
      compatibility: { compatible: true, changedDimensions: [] },
      metrics: {
        robustnessScore: { baseline: 1, candidate: 0.5, absoluteDelta: -0.5 },
        variance: { baseline: 0, candidate: 0.25, absoluteDelta: 0.25 },
        basePassed: { baseline: true, candidate: false },
      },
      createdAt: "2026-09-30T13:00:00.000Z",
    });

    const changed = compareRobustnessHistory(baseline, record("robust-other-profile", "c".repeat(64), result({ profileRevisionId: "profile-beta@1" })));
    expect(changed?.compatibility).toMatchObject({ compatible: false, changedDimensions: ["profileRevisionId"] });
  });

  it("rejects comparing a record with itself or records without valid content hashes", () => {
    const valid = record("robust-one", "a".repeat(64));
    expect(compareRobustnessHistory(valid, valid)).toBeNull();
    expect(compareRobustnessHistory(valid, record("robust-two", "missing"))).toBeNull();
  });

  it("exports both immutable source records with hash-linked evidence and a bounded integrity envelope", async () => {
    const baseline = record("robust-base", "a".repeat(64));
    const candidate = record("robust-candidate", "b".repeat(64), result({ robustnessScore: 0.5 }));
    const comparison = compareRobustnessHistory(baseline, candidate)!;
    const serialized = await exportRobustnessHistoryComparison(comparison, [
      { recordId: baseline.recordId, kind: "robustness_arena", contentHash: baseline.contentHash, payload: baseline.result },
      { recordId: candidate.recordId, kind: "robustness_arena", contentHash: candidate.contentHash, payload: candidate.result },
    ]);
    const exported = JSON.parse(serialized) as Record<string, any>;
    const { integrity, ...body } = exported;
    const canonical = canonicalJson(body);

    expect(exported.sources).toHaveLength(2);
    expect(exported.sources[0]).toMatchObject({ role: "baseline", recordId: baseline.recordId, contentHash: baseline.contentHash });
    expect(exported.sources[1]).toMatchObject({ role: "candidate", recordId: candidate.recordId, contentHash: candidate.contentHash });
    expect(integrity).toMatchObject({ algorithm: "sha-256", canonicalBodyBytes: expect.any(Number), canonicalBodySha256: expect.any(String) });
    expect(integrity.canonicalBodyBytes).toBe(new TextEncoder().encode(canonical).byteLength);
    expect(integrity.canonicalBodySha256).toBe(await sha256(canonical));
  });

  it("fails closed when an exported source record is absent or its hash changed", async () => {
    const baseline = record("robust-base", "a".repeat(64));
    const candidate = record("robust-candidate", "b".repeat(64));
    const comparison = compareRobustnessHistory(baseline, candidate)!;

    await expect(exportRobustnessHistoryComparison(comparison, []))
      .rejects.toThrow("missing or no longer matches");
    await expect(exportRobustnessHistoryComparison(comparison, [
      { recordId: baseline.recordId, kind: "robustness_arena", contentHash: baseline.contentHash, payload: baseline.result },
      { recordId: candidate.recordId, kind: "robustness_arena", contentHash: "c".repeat(64), payload: candidate.result },
    ])).rejects.toThrow("missing or no longer matches");
  });

  it("rejects a robustness comparison export that exceeds its serialized size bound", async () => {
    const largePrompt = "p".repeat(Math.floor(1.6 * 1_048_576));
    const largeVariant = { ...result().variants[0], sourcePrompt: largePrompt, prompt: largePrompt };
    const baseline = record("robust-base", "a".repeat(64), result({ variants: [largeVariant] }));
    const candidate = record("robust-candidate", "b".repeat(64), result({ variants: [largeVariant] }));
    const comparison = compareRobustnessHistory(baseline, candidate)!;

    await expect(exportRobustnessHistoryComparison(comparison, [
      { recordId: baseline.recordId, kind: "robustness_arena", contentHash: baseline.contentHash, payload: baseline.result },
      { recordId: candidate.recordId, kind: "robustness_arena", contentHash: candidate.contentHash, payload: candidate.result },
    ])).rejects.toThrow("bounded size limit");
  });
});
