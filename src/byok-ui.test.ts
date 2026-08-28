import { describe, expect, it } from "vitest";
import {
  byokErrorMessage,
  formatByokDecision,
  formatByokMoney,
  formatByokTokens,
  formatCredentialSource,
  formatIdentityConfidence,
  formatStorageStatus,
  validateByokBudget,
  validateByokConfiguration,
  validateByokGeneration,
  validateByokPriceSnapshot,
  type ByokPriceSnapshotDraft,
} from "./byok-ui";

const PRICE_DRAFT: ByokPriceSnapshotDraft = {
  modelId: "model-example",
  capturedOn: "2026-08-20",
  inputUsdPerMillionTokens: "2",
  outputUsdPerMillionTokens: "4",
};

describe("BYOK UI helpers", () => {
  it("validates a dated price snapshot against the configured model", () => {
    const validation = validateByokPriceSnapshot("openai", "model-example", PRICE_DRAFT);

    expect(validation.valid).toBe(true);
    expect(validation.snapshot).toMatchObject({
      providerId: "openai",
      modelId: "model-example",
      capturedOn: "2026-08-20",
      currency: "USD",
      inputUsdPerMillionTokens: 2,
      outputUsdPerMillionTokens: 4,
    });

    const mismatched = validateByokPriceSnapshot("openai", "model-example", {
      ...PRICE_DRAFT,
      modelId: "other-model",
    });
    expect(mismatched.valid).toBe(false);
    expect(mismatched.errors.modelId).toContain("match");
  });

  it("keeps configuration and budget validation bounded", () => {
    const configuration = validateByokConfiguration({
      endpoint: "http://example.invalid",
      model: "model example",
      apiKey: "",
    });
    expect(configuration.valid).toBe(false);
    expect(configuration.errors.endpoint).toContain("HTTPS");
    expect(configuration.errors.model).toBeDefined();
    expect(configuration.errors.apiKey).toBeDefined();

    const policy = validateByokBudget({
      confirmationThresholdUsd: "5",
      ceilingUsd: "4",
    });
    expect(policy.valid).toBe(false);
    expect(policy.errors.confirmationThresholdUsd).toContain("hard ceiling");
  });

  it("requires consent and cost confirmation when the estimate crosses the threshold", () => {
    const validation = validateByokGeneration(
      "openai",
      "model-example",
      { confirmationThresholdUsd: 0.00001, ceilingUsd: 1 },
      {
        prompt: "hello",
        maxOutputTokens: "4",
        priceSnapshot: PRICE_DRAFT,
        networkConsent: false,
        costConfirmed: false,
      },
    );

    expect(validation.estimate).toMatchObject({ status: "estimated", totalCostUsd: 0.000026 });
    expect(validation.budgetDecision).toMatchObject({ decision: "confirm" });
    expect(validation.valid).toBe(false);
    expect(validation.errors.networkConsent).toBeDefined();
    expect(validation.errors.costConfirmed).toBeDefined();

    const confirmed = validateByokGeneration(
      "openai",
      "model-example",
      { confirmationThresholdUsd: 0.00001, ceilingUsd: 1 },
      {
        prompt: "hello",
        maxOutputTokens: "4",
        priceSnapshot: PRICE_DRAFT,
        networkConsent: true,
        costConfirmed: true,
      },
    );
    expect(confirmed.valid).toBe(true);
  });

  it("formats sanitized provider state and never echoes unknown error text", () => {
    expect(formatByokMoney(0.000026)).toBe("$0.000026");
    expect(formatByokMoney(null)).toBe("Not set");
    expect(formatByokTokens(1234)).toBe("1,234");
    expect(formatByokDecision("confirmation_required")).toBe("Confirmation required");
    expect(formatIdentityConfidence("provider_reported")).toBe("Provider reported");
    expect(formatStorageStatus("available")).toBe("Available");
    expect(formatCredentialSource("os_secure_storage")).toBe("OS secure storage");
    expect(byokErrorMessage({ code: "provider_confirmation_required", message: "untrusted text" })).toBe(
      "Explicit cost confirmation is required.",
    );
    expect(byokErrorMessage({ message: "untrusted text" })).not.toContain("untrusted text");
  });
});
