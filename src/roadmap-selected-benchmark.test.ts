import { describe, expect, it } from "vitest";
import { currentBenchmarkSelection } from "./roadmap-features-view";
import type { BenchmarkVersion } from "./bridge";
import type { ArenaDocument } from "./arena-ui";

describe("Insights benchmark selection", () => {
  const versionA = { summary: { versionId: "version-a" } } as BenchmarkVersion;
  const documentA = { tasks: [] } as unknown as ArenaDocument;

  it("rejects the previous benchmark while a newly selected version is loading", () => {
    expect(currentBenchmarkSelection("version-b", versionA, documentA)).toBeNull();
  });

  it("allows execution only after the selected version and its document are loaded", () => {
    expect(currentBenchmarkSelection("version-a", versionA, null)).toBeNull();
    expect(currentBenchmarkSelection("version-a", versionA, documentA)).toEqual({ version: versionA, document: documentA });
  });
});
