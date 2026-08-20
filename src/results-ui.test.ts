import { describe, expect, it } from "vitest";
import {
  attemptStatusLabel,
  attemptStatusTone,
  formatByteCount,
  formatCount,
  formatDurationNs,
  objectiveVerificationEvidence,
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
});
