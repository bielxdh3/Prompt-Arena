import { describe, expect, it } from "vitest";
import {
  attemptStatusLabel,
  attemptStatusTone,
  formatByteCount,
  formatCount,
  formatDurationNs,
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
});
