import { describe, expect, it } from "vitest";
import { executeRobustnessVariants, generatePerturbations, isEffectivePerturbation, scoreRobustness } from "./robustness-arena";

describe("robustness arena", () => {
  it("generates versioned variants and clusters failures", () => {
    const variants = generatePerturbations("Solve x + 1 = 2", "1", "logic@1", 10, ["concise_wording", "irrelevant_noise"]);
    const result = scoreRobustness(true, variants.map((variant, index) => ({ ...variant, passed: index === 0, executionStatus: "completed" as const })), "2026-09-12T00:00:00Z", {
      taskId: "task-1",
      caseId: "case-1",
      profileRevisionId: "profile@1",
      baseRunId: "base-run",
      baseAttemptId: "base-attempt",
      baseEvidenceSaved: true,
    });
    expect(result.robustnessScore).toBe(0.5);
    expect(result.failureClusters).toEqual(["irrelevant_noise"]);
    expect(result).toMatchObject({ taskId: "task-1", caseId: "case-1", baseRunId: "base-run", baseAttemptId: "base-attempt", baseEvidenceSaved: true });
  });

  it("isolates execution and evidence failures while retaining returned terminal states", async () => {
    const variants = generatePerturbations("Solve a stable task.", "ok", "bench@1", 1, ["concise_wording", "verbose_wording", "irrelevant_noise", "formatting_variation"]);
    const persisted: string[] = [];
    const outcomes = await executeRobustnessVariants(
      variants,
      async (variant) => {
        if (variant.transformationType === "concise_wording") throw new Error("runtime unavailable");
        if (variant.transformationType === "verbose_wording") return { status: "cancelled", passed: null, runId: "run-cancel", attemptId: "attempt-cancel", value: "cancelled" };
        if (variant.transformationType === "irrelevant_noise") return { status: "completed", passed: false, runId: "run-unpersisted", attemptId: "attempt-unpersisted", value: "unpersisted-complete" };
        return { status: "completed", passed: true, runId: "run-complete", attemptId: "attempt-complete", value: "complete" };
      },
      async (_variant, value) => {
        if (value === "cancelled" || value === "unpersisted-complete") throw new Error("artifact store unavailable");
        persisted.push(value);
      },
    );

    expect(outcomes.map((outcome) => outcome.executionStatus)).toEqual(["failed", "cancelled", "completed", "completed"]);
    expect(outcomes[0].errorCode).toBe("execution_failed");
    expect(outcomes[1].errorCode).toBe("evidence_save_failed");
    expect(outcomes[2]).toMatchObject({ passed: false, runId: "run-unpersisted", errorCode: "evidence_save_failed" });
    expect(persisted).toEqual(["complete"]);
    expect(outcomes[3].passed).toBe(true);
    const scored = scoreRobustness(null, outcomes);
    expect(scored.robustnessScore).toBe(1);
    expect(scored.failureClusters).toEqual([]);
  });

  it("rejects source truncation and invalid seed or operator sets", () => {
    expect(() => generatePerturbations("x".repeat(256 * 1024 + 1), "expected", "bench@1", 1, ["paraphrase"])).toThrow("size limit");
    expect(() => generatePerturbations("task", "expected", "bench@1", -1, ["paraphrase"])).toThrow("seed");
    expect(() => generatePerturbations("task", "expected", "bench@1", 1, ["paraphrase", "paraphrase"])).toThrow("set is invalid");
  });

  it("keeps the source verifier expectation while applying a versioned variable rename", () => {
    const [variant] = generatePerturbations("Solve x + 1 = 2", "1", "bench@1", 1, ["variable_rename"]);
    expect(variant.prompt).toContain("x_renamed");
    expect(variant.expected).toBe("1");
    expect(variant.provenance).toBe("deterministic-local/variable_rename/v2");
    expect(variant.version).toBe("2");
  });

  it("changes effective prompts for applicable transforms and marks no-ops unavailable", () => {
    const source = "Solve x + 1 = 2.\n\nReturn the exact answer.";
    const variants = generatePerturbations(source, "1", "bench@1", 1);
    expect(variants.find((variant) => variant.transformationType === "paraphrase")?.prompt).toContain("work out");
    expect(variants.find((variant) => variant.transformationType === "instruction_reorder")?.prompt).toBe("Return the exact answer.\n\nSolve x + 1 = 2.");
    expect(variants.find((variant) => variant.transformationType === "formatting_variation")?.prompt).toContain("\n");
    expect(variants.every((variant) => variant.prompt !== source)).toBe(true);

    const [noParaphrase] = generatePerturbations("Consider the following input.", null, "bench@1", 1, ["paraphrase"]);
    expect(isEffectivePerturbation(noParaphrase, noParaphrase.prompt, noParaphrase.sourcePrompt)).toBe(false);
    expect(isEffectivePerturbation(variants[0], variants[0].prompt, variants[0].sourcePrompt)).toBe(true);
    expect(isEffectivePerturbation(variants[0], source, source)).toBe(false);
  });
});
