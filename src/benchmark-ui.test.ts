import { describe, expect, it } from "vitest";
import { benchmarkEmptyCopy, benchmarkPreviewCopy, classifyBenchmarkSurface } from "./benchmark-ui";

describe("benchmark surface states", () => {
  it("keeps browser preview separate from saved-record states", () => {
    expect(classifyBenchmarkSurface({ desktop: false, draftCount: 0, versionCount: 0 })).toBe("preview");
    expect(benchmarkPreviewCopy()).toContain("does not load, save, validate, or publish");
  });

  it("distinguishes empty and error states from ready records", () => {
    expect(classifyBenchmarkSurface({ desktop: true, draftCount: 0, versionCount: 0 })).toBe("empty");
    expect(classifyBenchmarkSurface({ desktop: true, draftCount: 0, versionCount: 0, error: "offline" })).toBe("error");
    expect(classifyBenchmarkSurface({ desktop: true, draftCount: 1, versionCount: 0 })).toBe("ready");
    expect(benchmarkEmptyCopy()).toContain("Nothing is bundled or invented");
  });
});
