export const PERTURBATION_TYPES = ["paraphrase", "instruction_reorder", "variable_rename", "formatting_variation", "concise_wording", "verbose_wording", "irrelevant_noise"] as const;
export type PerturbationType = (typeof PERTURBATION_TYPES)[number];
export type PerturbedTask = { perturbationId: string; transformationType: PerturbationType; version: "1"; seed: number; sourceTaskVersion: string; sourcePrompt: string; prompt: string; expected: unknown; provenance: string };
export type RobustnessResult = { schemaVersion: 1; kind: "robustness_arena"; sourceTaskVersion: string; basePassed: boolean | null; variants: Array<PerturbedTask & { passed: boolean | null; runId?: string; attemptId?: string }>; robustnessScore: number | null; variance: number | null; failureClusters: string[]; createdAt: string };

export function generatePerturbations(sourcePrompt: string, expected: unknown, sourceTaskVersion: string, seed: number, types: readonly PerturbationType[] = PERTURBATION_TYPES): PerturbedTask[] {
  const bounded = sourcePrompt.trim().slice(0, 256 * 1024);
  if (!bounded) throw new Error("A source prompt is required for perturbation.");
  return [...types].map((type, index) => {
    const perturbationId = `perturb-${sourceTaskVersion}-${seed}-${index + 1}`.replace(/[^A-Za-z0-9._-]/gu, "-");
    return { perturbationId, transformationType: type, version: "1", seed: seed + index, sourceTaskVersion, sourcePrompt: bounded, prompt: perturbPrompt(bounded, type, seed + index), expected, provenance: `deterministic-local/${type}/v1` };
  });
}

function perturbPrompt(prompt: string, type: PerturbationType, seed: number): string {
  if (type === "instruction_reorder") return `First reason about the task, then provide the final answer.\n\n${prompt}`;
  if (type === "variable_rename") return prompt.replace(/\b(foo|bar|baz|x|y|z)\b/giu, (match) => `${match}_renamed`);
  if (type === "formatting_variation") return prompt.split(/\r?\n/gu).map((line) => `- ${line.trim()}`).join("\n");
  if (type === "concise_wording") return `Answer concisely:\n${prompt}`;
  if (type === "verbose_wording") return `Please provide a complete, careful answer while preserving the exact task and expected contract below.\n${prompt}`;
  if (type === "irrelevant_noise") return `${prompt}\n\nContext note ${Math.abs(seed) % 997}: this note is irrelevant to the task and must not affect the answer.`;
  return `Solve the following task using the same expected answer contract:\n${prompt}`;
}

export function scoreRobustness(basePassed: boolean | null, variants: ReadonlyArray<PerturbedTask & { passed: boolean | null; runId?: string; attemptId?: string }>, createdAt = new Date().toISOString()): RobustnessResult {
  const observed = variants.map((variant) => variant.passed).filter((value): value is boolean => typeof value === "boolean");
  const values: number[] = observed.map((value): number => value ? 1 : 0);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const variance = values.length ? values.reduce((sum, value) => sum + ((value - (average ?? 0)) ** 2), 0) / values.length : null;
  const clusters = variants.filter((variant) => variant.passed === false).map((variant) => variant.transformationType);
  return { schemaVersion: 1, kind: "robustness_arena", sourceTaskVersion: variants[0]?.sourceTaskVersion ?? "unknown", basePassed, variants: [...variants], robustnessScore: average, variance, failureClusters: [...new Set(clusters)], createdAt };
}

