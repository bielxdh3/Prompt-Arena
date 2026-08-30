import { describe, expect, it } from "vitest";
import {
  attemptStatusLabel,
  attemptStatusTone,
  BLIND_RESPONSE_MAX_HEIGHT_PX,
  blindReviewHidesAttemptEvidence,
  blindEvaluationScoreLabel,
  blindEvaluationStatusLabel,
  formatByteCount,
  formatCount,
  formatDurationNs,
  objectiveVerificationEvidence,
  updateBlindEvaluationScore,
} from "./results-ui";

describe("read-only results formatting", () => {
  it("normalizes terminal status labels and tones", () => {
    expect(attemptStatusLabel("completed")).toBe("Completed");
    expect(attemptStatusLabel("cancelled")).toBe("Cancelled");
    expect(attemptStatusLabel("failed")).toBe("Failed");
    expect(attemptStatusTone("completed")).toBe("success");
    expect(attemptStatusTone("failed")).toBe("failure");
    expect(attemptStatusTone("cancelled")).toBe("neutral");
  });

  it("formats bounded counts, bytes, and timing without inventing missing metrics", () => {
    expect(formatCount(1024)).toBe("1,024");
    expect(formatCount(null)).toBe("Not recorded");
    expect(formatByteCount(1024)).toBe("1.0 KiB");
    expect(formatDurationNs(1_500_000)).toBe("1.50 ms");
    expect(formatDurationNs(undefined)).toBe("Not recorded");
  });

  it("recognizes only exact-text score evidence and preserves unknown shapes", () => {
    const evidence = objectiveVerificationEvidence({
      passed: true,
      verifierKind: "exact_text",
      expectedNormalizedByteCount: 8,
      actualNormalizedByteCount: 9,
      expectedSha256: "a".repeat(64),
      actualSha256: "b".repeat(64),
    });
    expect(evidence?.passed).toBe(true);
    expect(evidence?.expectedNormalizedByteCount).toBe(8);
    expect(objectiveVerificationEvidence({ verifierKind: "human", score: 1 })).toBeNull();
    expect(objectiveVerificationEvidence("response text")).toBeNull();
  });

  it("keeps blind-evaluation states and score controls bounded", () => {
    expect(blindReviewHidesAttemptEvidence("loading")).toBe(true);
    expect(blindReviewHidesAttemptEvidence("preparing")).toBe(true);
    expect(blindReviewHidesAttemptEvidence("prepared")).toBe(true);
    expect(blindReviewHidesAttemptEvidence("empty")).toBe(true);
    expect(blindReviewHidesAttemptEvidence("error")).toBe(true);
    expect(blindReviewHidesAttemptEvidence("idle")).toBe(false);
    expect(blindReviewHidesAttemptEvidence("locked")).toBe(false);
    expect(blindReviewHidesAttemptEvidence("unknown")).toBe(true);
    expect(blindEvaluationStatusLabel("prepared")).toBe("Ready for blind review");
    expect(blindEvaluationStatusLabel("locked")).toBe("Locked and read-only");
    expect(blindEvaluationStatusLabel("unknown")).toBe("Evaluation unavailable");
    expect(blindEvaluationScoreLabel(5)).toBe("5/5");
    expect(blindEvaluationScoreLabel(0)).toBe("Not scored");
  });

  it("keeps score edits local, bounded, and prepared", () => {
    const scores = { first: null, second: 2 };
    expect(updateBlindEvaluationScore(scores, "first", "5")).toEqual({ first: 5, second: 2 });
    expect(updateBlindEvaluationScore(scores, "first", "9")).toEqual(scores);
    expect(blindReviewHidesAttemptEvidence("prepared")).toBe(true);
  });

  it("keeps blind results hidden until the immutable lock state", () => {
    expect(blindEvaluationStatusLabel("prepared")).toBe("Ready for blind review");
    expect(blindReviewHidesAttemptEvidence("prepared")).toBe(true);
    expect(blindEvaluationStatusLabel("locked")).toBe("Locked and read-only");
    expect(blindReviewHidesAttemptEvidence("locked")).toBe(false);
  });

  it("keeps the full response pane inside a bounded scroll region", () => {
    expect(BLIND_RESPONSE_MAX_HEIGHT_PX).toBe(320);
    expect(BLIND_RESPONSE_MAX_HEIGHT_PX).toBeGreaterThan(0);
  });
});
