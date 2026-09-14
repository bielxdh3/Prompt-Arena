import { formatLocaleNumber, translate } from "./i18n";

// Display labels never replace persisted identity. Callers retain IDs for selection and diagnostics.
export function displayName(value: unknown, fallback: string, ordinal?: number): string {
  const name = typeof value === "string" ? value.trim() : "";
  const machine = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|^[0-9a-f]{32,}$|^(?:arena|run|profile|case|task|benchmark|sample|execution|result)[-_]\d+(?:[-_@]\d+)*$/i;
  return name && !machine.test(name)
    ? name
    : `${translate(fallback)}${ordinal === undefined ? "" : ` ${formatLocaleNumber(ordinal)}`}`;
}

export function numberedName(kind: string, id: string, ids: readonly string[]): string {
  const index = [...new Set(ids)].sort().indexOf(id);
  return `${translate(kind)} ${formatLocaleNumber(Math.max(0, index) + 1)}`;
}

export function profileDisplayName(profile: { model: string; revision: number; runtime: string }): string {
  return `${displayName(profile.model, "Model")} · ${translate("Configuration")} ${formatLocaleNumber(profile.revision)} · ${profile.runtime}`;
}

const METRIC_NAMES: Record<string, string> = {
  ttftMs: "Time to first token", promptTokens: "Prompt tokens", completionTokens: "Completion tokens",
  totalTokens: "Total tokens", generationTokensPerSecond: "Tokens/s", wallClockMs: "Total duration",
  loadTimeMs: "Load duration", generationTimeMs: "Generation time", thinkingTimeMs: "Thinking time",
  vramAverageBytes: "Average VRAM", vramPeakBytes: "Peak VRAM", ramAverageBytes: "Average RAM",
  ramPeakBytes: "Peak RAM", cpuUtilizationPercent: "CPU usage", gpuUtilizationPercent: "GPU usage",
  energyWh: "Energy", quality: "Quality", benchmarkVersionId: "Benchmark version", runtime: "Runtime",
  model: "Model", quantization: "Quantization", context: "Context length", seed: "Seed",
  promptArenaVersion: "App version", hardware: "Hardware",
  paraphrase: "Paraphrase", instruction_reorder: "Instruction order", formatting_variation: "Formatting",
  concise_wording: "Concise wording", verbose_wording: "Detailed wording", irrelevant_noise: "Irrelevant context",
};

export function metricDisplayName(key: string): string {
  return translate(METRIC_NAMES[key] ?? "Metric");
}
