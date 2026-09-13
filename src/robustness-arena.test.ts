import { describe, expect, it } from "vitest";
import { generatePerturbations, scoreRobustness } from "./robustness-arena";

describe("robustness arena", () => {
  it("generates versioned variants and clusters failures", () => {
    const variants = generatePerturbations("Solve x + 1 = 2", "1", "logic@1", 10, ["concise_wording", "irrelevant_noise"]);
    const result = scoreRobustness(true, variants.map((variant, index) => ({ ...variant, passed: index === 0 })), "2026-09-12T00:00:00Z");
    expect(result.robustnessScore).toBe(0.5);
    expect(result.failureClusters).toEqual(["irrelevant_noise"]);
  });
});
