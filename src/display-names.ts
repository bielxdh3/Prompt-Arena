import { formatLocaleNumber, translate } from "./i18n";

// Display labels never replace persisted identity. Callers retain IDs for selection and diagnostics.
export function isMachineIdentity(value: unknown): boolean {
  const name = typeof value === "string" ? value.trim() : "";
  return Boolean(name) && (
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(name)
    || /^[0-9a-f]{32,}$/i.test(name)
    || /^(?:arena|run|profile|case|task|benchmark|sample|execution|attempt|result|tournament|calibration|judge|source|bundle|regression|match|model|competitor|candidate|baseline|revision|version|provider|artifact|materialization|evaluation|summary|sweep|variant|objective|config|metric|rubric)(?:[-_:@.])/i.test(name)
    || /^[A-Za-z][A-Za-z0-9._-]*@\d+$/i.test(name)
  );
}

export function containsMachineIdentity(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return value.split(/[\s·/:]+/u).some((part) => isMachineIdentity(part));
}

export function displayName(value: unknown, fallback: string, ordinal?: number): string {
  const name = typeof value === "string" ? value.trim() : "";
  return name && !isMachineIdentity(name)
    ? name
    : `${translate(fallback)}${ordinal === undefined ? "" : ` ${formatLocaleNumber(ordinal)}`}`;
}

export function numberedName(kind: string, id: string, ids: readonly string[]): string {
  const index = [...new Set(ids)].sort().indexOf(id);
  return `${translate(kind)} ${formatLocaleNumber(Math.max(0, index) + 1)}`;
}

export function profileDisplayName(profile: { model: string; revision: number; runtime: string }): string {
  return `${displayName(profile.model, "Model")} · ${translate("Configuration")} ${formatLocaleNumber(profile.revision)} · ${runtimeDisplayName(profile.runtime)}`;
}

export function runtimeDisplayName(runtime: string): string {
  switch (runtime.trim().toLowerCase()) {
    case "ollama": return "Ollama";
    case "lm_studio": return "LM Studio";
    case "llama_cpp": return "llama.cpp";
    case "local": return translate("Local runtime");
    default: return displayName(runtime, "Runtime");
  }
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
