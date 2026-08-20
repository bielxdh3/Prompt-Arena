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
  return "There are no local benchmark drafts or immutable versions yet. Bundled official packs are read-only source records; no sample local records are invented.";
}

export function benchmarkPreviewCopy(): string {
  return "Browser preview shows the editor only. It does not load, save, validate, or publish desktop records.";
}

export function officialPacksPreviewCopy(): string {
  return "Browser preview does not load the bundled catalog or expose official documents; it performs no desktop reads or writes.";
}
