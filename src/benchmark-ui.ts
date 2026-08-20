export type BenchmarkSurfaceState = "preview" | "empty" | "ready" | "error";

export function classifyBenchmarkSurface(input: {
  desktop: boolean;
  draftCount: number;
  versionCount: number;
  error?: string;
}): BenchmarkSurfaceState {
  if (!input.desktop) return "preview";
  if (input.error) return "error";
  if (input.draftCount === 0 && input.versionCount === 0) return "empty";
  return "ready";
}

export function benchmarkEmptyCopy(): string {
  return "There are no local benchmark drafts or immutable versions yet. Nothing is bundled or invented in this view.";
}

export function benchmarkPreviewCopy(): string {
  return "Browser preview shows the editor only. It does not load, save, validate, or publish desktop records.";
}
