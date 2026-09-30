import type { PromptTransformationType, PromptVariant } from "./bridge";

export const PERTURBATION_TYPES = ["paraphrase", "instruction_reorder", "variable_rename", "formatting_variation", "concise_wording", "verbose_wording", "irrelevant_noise"] as const;
export type PerturbationType = PromptTransformationType;
export type PerturbedTask = PromptVariant & { perturbationId: string; sourcePrompt: string; prompt: string; expected: unknown; provenance: string };
export type RobustnessVariantOutcome = PerturbedTask & {
  passed: boolean | null;
  runId?: string;
  attemptId?: string;
  executionStatus: "completed" | "failed" | "cancelled" | "unavailable";
  errorCode?: "execution_failed" | "evidence_save_failed";
};
export type RobustnessResult = {
  schemaVersion: 1;
  kind: "robustness_arena";
  sourceTaskVersion: string;
  taskId: string | null;
  caseId: string | null;
  profileRevisionId: string | null;
  basePassed: boolean | null;
  baseRunId: string | null;
  baseAttemptId: string | null;
  baseEvidenceSaved: boolean | null;
  baseStatus: "completed" | "failed" | "cancelled" | "unavailable";
  variants: RobustnessVariantOutcome[];
  robustnessScore: number | null;
  variance: number | null;
  failureClusters: string[];
  createdAt: string;
};

const MAX_PROMPT_BYTES = 256 * 1024;
const MAX_VARIANTS = PERTURBATION_TYPES.length;

export function generatePerturbations(sourcePrompt: string, expected: unknown, sourceTaskVersion: string, seed: number, types: readonly PerturbationType[] = PERTURBATION_TYPES): PerturbedTask[] {
  const bounded = sourcePrompt.trim();
  if (!bounded) throw new Error("A source prompt is required for perturbation.");
  if (new TextEncoder().encode(bounded).length > MAX_PROMPT_BYTES) throw new Error("The source prompt exceeds the perturbation size limit.");
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff - MAX_VARIANTS) throw new Error("The perturbation seed is outside the supported range.");
  if (types.length === 0 || types.length > MAX_VARIANTS || new Set(types).size !== types.length || types.some((type) => !PERTURBATION_TYPES.includes(type))) {
    throw new Error("The perturbation set is invalid.");
  }
  return [...types].map((type, index) => {
    const perturbationId = `perturb-${sourceTaskVersion}-${seed}-${index + 1}`.replace(/[^A-Za-z0-9._-]/gu, "-");
    const promptVariant: PromptVariant = {
      transformationType: type,
      version: "2",
      seed: seed + index,
      sourceTaskVersion,
    };
    return { ...promptVariant, perturbationId, sourcePrompt: bounded, prompt: derivePromptVariantPrompt(bounded, promptVariant), expected, provenance: `deterministic-local/${type}/v2` };
  });
}

export function derivePromptVariantPrompt(prompt: string, variant: PromptVariant): string {
  if (variant.version !== "2") throw new Error("Prompt variant version is unsupported.");
  if (!Number.isSafeInteger(variant.seed) || variant.seed < 0 || variant.seed > 0xffff_ffff) {
    throw new Error("Prompt variant seed is outside the supported range.");
  }
  if (new TextEncoder().encode(prompt).length > MAX_PROMPT_BYTES) {
    throw new Error("The source prompt exceeds the perturbation size limit.");
  }
  return perturbPrompt(prompt, variant.transformationType, variant.seed);
}

function perturbPrompt(prompt: string, type: PerturbationType, seed: number): string {
  if (type === "paraphrase") {
    const alternatives: Record<string, string> = {
      solve: "work out", calculate: "compute", compute: "calculate", summarize: "give a summary of",
      describe: "explain", explain: "describe", compare: "contrast", classify: "categorize",
      list: "enumerate", write: "compose", answer: "respond to",
    };
    return prompt.replace(/^(please\s+)?(solve|calculate|compute|summarize|describe|explain|compare|classify|list|write|answer)\b/iu,
      (_match, polite: string | undefined, command: string) => `${polite ?? ""}${alternatives[command.toLowerCase()]}`);
  }
  if (type === "instruction_reorder") {
    const paragraphs = prompt.split(/\n{2,}/u);
    return paragraphs.length > 1 ? [...paragraphs.slice(1), paragraphs[0]].join("\n\n") : prompt;
  }
  if (type === "variable_rename") return prompt.replace(/\b(foo|bar|baz|x|y|z)\b/giu, (match) => `${match}_renamed`);
  if (type === "formatting_variation") {
    const whitespace = [...prompt.matchAll(/[ \t]+/gu)];
    if (whitespace.length === 0) return prompt;
    const selected = whitespace[Math.floor(whitespace.length / 2)];
    const start = selected.index ?? 0;
    return `${prompt.slice(0, start)}\n${prompt.slice(start + selected[0].length)}`;
  }
  if (type === "concise_wording") return `Please answer concisely while preserving every requirement and the requested output format.\n\n${prompt}`;
  if (type === "verbose_wording") return `Provide a fuller explanation while preserving every requirement and the requested output format.\n\n${prompt}`;
  if (type === "irrelevant_noise") return `${prompt}\n\nContext note ${Math.abs(seed) % 997}: this note is irrelevant to the task and must not affect the answer.`;
  return prompt;
}

export function isEffectivePerturbation(variant: PerturbedTask, effectivePrompt: string, basePrompt: string): boolean {
  return variant.prompt !== variant.sourcePrompt && effectivePrompt !== basePrompt;
}

export async function executeRobustnessVariants<T>(
  variants: ReadonlyArray<PerturbedTask>,
  execute: (variant: PerturbedTask) => Promise<{ status: "completed" | "failed" | "cancelled" | "unavailable"; passed: boolean | null; runId?: string; attemptId?: string; value?: T }>,
  persist: (variant: PerturbedTask, value: T) => Promise<void>,
): Promise<RobustnessVariantOutcome[]> {
  const outcomes: RobustnessVariantOutcome[] = [];
  for (const variant of variants) {
    let result: Awaited<ReturnType<typeof execute>>;
    try {
      result = await execute(variant);
    } catch {
      outcomes.push({ ...variant, passed: null, executionStatus: "failed", errorCode: "execution_failed" });
      continue;
    }
    let errorCode: RobustnessVariantOutcome["errorCode"];
    if (result.value !== undefined && result.status !== "unavailable") {
      try {
        await persist(variant, result.value);
      } catch {
        errorCode = "evidence_save_failed";
      }
    }
    outcomes.push({
      ...variant,
      passed: result.status === "completed" ? result.passed : null,
      ...(result.runId ? { runId: result.runId } : {}),
      ...(result.attemptId ? { attemptId: result.attemptId } : {}),
      executionStatus: result.status,
      ...(errorCode ? { errorCode } : {}),
    });
  }
  return outcomes;
}

export function scoreRobustness(
  basePassed: boolean | null,
  variants: ReadonlyArray<RobustnessVariantOutcome>,
  createdAt = new Date().toISOString(),
  context: { taskId?: string; caseId?: string; profileRevisionId?: string; baseRunId?: string; baseAttemptId?: string; baseEvidenceSaved?: boolean; baseStatus?: RobustnessResult["baseStatus"] } = {},
): RobustnessResult {
  const scoredVariants = variants.filter((variant) => variant.errorCode !== "evidence_save_failed");
  const observed = scoredVariants.map((variant) => variant.passed).filter((value): value is boolean => typeof value === "boolean");
  const values: number[] = observed.map((value): number => value ? 1 : 0);
  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const variance = values.length ? values.reduce((sum, value) => sum + ((value - (average ?? 0)) ** 2), 0) / values.length : null;
  const clusters = scoredVariants.filter((variant) => variant.passed === false).map((variant) => variant.transformationType);
  return {
    schemaVersion: 1,
    kind: "robustness_arena",
    sourceTaskVersion: variants[0]?.sourceTaskVersion ?? "unknown",
    taskId: context.taskId ?? null,
    caseId: context.caseId ?? null,
    profileRevisionId: context.profileRevisionId ?? null,
    basePassed,
    baseRunId: context.baseRunId ?? null,
    baseAttemptId: context.baseAttemptId ?? null,
    baseEvidenceSaved: context.baseEvidenceSaved ?? null,
    baseStatus: context.baseStatus ?? (basePassed === null ? "unavailable" : "completed"),
    variants: [...variants],
    robustnessScore: average,
    variance,
    failureClusters: [...new Set(clusters)],
    createdAt,
  };
}

