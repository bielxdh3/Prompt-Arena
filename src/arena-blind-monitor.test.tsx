import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArenaExecutionMonitor } from "./App";
import type { ArenaTelemetry } from "./arena-runner";

const metrics = {
  loadDurationMs: 50,
  ttftMs: 100,
  generationDurationMs: 750,
  promptTokens: 10,
  completionTokens: 75,
  totalTokens: 85,
  tokensPerSecond: 100,
  authoritative: true,
};

const telemetry: ArenaTelemetry = {
  state: "running",
  startedAtMs: 0,
  wallElapsedMs: 2500,
  completed: 1,
  total: 2,
  activeSampleIndex: 1,
  etaMs: 1000,
  lastError: "private-model-a generation failed",
  samples: [
    { competitorId: "private-model-a", competitorLabel: "private-model-a", competitorOrdinal: 0, repetition: 1, sampleIndex: 0, status: "completed", startedAtMs: 0, elapsedMs: 1000, durationMs: 1000, metrics, error: null },
    { competitorId: "private-model-b", competitorLabel: "private-model-b", competitorOrdinal: 1, repetition: 1, sampleIndex: 1, status: "generating", startedAtMs: 1000, elapsedMs: 1500, durationMs: null, metrics, error: null },
  ],
};

describe("blind Arena monitor", () => {
  it("hides per-sample completion counts and timing correlations in both visual and screen-reader output", () => {
    const markup = renderToStaticMarkup(<ArenaExecutionMonitor telemetry={telemetry} blind saving={false} cancelNotice={null} onCancel={() => undefined} />);
    expect(markup).not.toContain("1/2");
    expect(markup).not.toContain("1 / 2 samples");
    expect(markup).not.toContain("private-model-a");
    expect(markup).not.toContain("private-model-b");
    expect(markup).not.toContain("100 tok/s");
    expect(markup).not.toContain("Failure recorded:");
    expect(markup).toContain("Hidden until reveal");
  });

  it("keeps measurable progress visible for an ordinary Arena run", () => {
    const markup = renderToStaticMarkup(<ArenaExecutionMonitor telemetry={telemetry} blind={false} saving={false} cancelNotice={null} onCancel={() => undefined} />);
    expect(markup).toContain("1/2");
    expect(markup).toContain("private-model-a");
  });
});
