import { describe, expect, it } from "vitest";
import {
  PROVIDER_CATALOG,
  type PriceTableSnapshot,
  decideProviderBudget,
  estimateProviderCost,
  normalizeProviderSelection,
  providerPreviewCopy,
} from "./provider-foundation";

const PRICE_TABLE: PriceTableSnapshot = {
  providerId: "openai",
  modelId: "gpt-example",
  capturedOn: "2026-08-20",
  currency: "USD",
  inputUsdPerMillionTokens: 2,
  outputUsdPerMillionTokens: 4,
};

describe("external provider foundation", () => {
  it("keeps the provider catalog complete and explicitly unconfigured", () => {
    expect(PROVIDER_CATALOG.map((provider) => provider.id)).toEqual([
      "openai-compatible",
      "openai",
      "anthropic",
      "gemini",
    ]);
    expect(new Set(PROVIDER_CATALOG.map((provider) => provider.id)).size).toBe(4);
    for (const provider of PROVIDER_CATALOG) {
      expect(provider.transportStatus).toBe("external_network_not_wired");
      expect(provider.credentialSource).toBe("not_configured");
      expect(provider.identityConfidence).toBe("unverified");
      expect(provider.capabilities.execution).toBe("not_wired");
      expect(provider.capabilities.modelDiscovery).toBe("not_wired");
      expect(provider.capabilities.costEstimation).toBe("catalog_only");
    }
  });

  it("keeps missing credentials and uncertain model identity explicit", () => {
    const selection = normalizeProviderSelection({ providerId: "anthropic", modelId: "claude-example" });
    expect(selection).toEqual({
      providerId: "anthropic",
      modelId: "claude-example",
      credentialSource: "not_configured",
      identityConfidence: "unverified",
    });
  });

  it("does not retain unknown credential-like fields during sanitization", () => {
    const selection = normalizeProviderSelection({
      providerId: "openai",
      modelId: " gpt-example ",
      apiKey: "discard-me",
      token: "discard-me-too",
      authorization: "discard-this",
    });
    expect(selection).toEqual({
      providerId: "openai",
      modelId: "gpt-example",
      credentialSource: "not_configured",
      identityConfidence: "unverified",
    });
    expect(JSON.stringify(selection)).not.toContain("discard");
    expect(normalizeProviderSelection({ providerId: "unknown", modelId: "\u0000" })).toMatchObject({
      providerId: "openai-compatible",
      modelId: null,
    });
  });

  it("calculates bounded input and output cost from a dated snapshot", () => {
    expect(estimateProviderCost(PRICE_TABLE, { inputTokens: 1_500_000, outputTokens: 500_000 })).toEqual({
      status: "estimated",
      providerId: "openai",
      modelId: "gpt-example",
      capturedOn: "2026-08-20",
      inputCostUsd: 3,
      outputCostUsd: 2,
      totalCostUsd: 5,
    });
    expect(estimateProviderCost({ ...PRICE_TABLE, inputUsdPerMillionTokens: null }, { inputTokens: 1, outputTokens: 1 })).toEqual({
      status: "unavailable",
      reason: "missing_price",
    });
    expect(estimateProviderCost({ ...PRICE_TABLE, outputUsdPerMillionTokens: Number.POSITIVE_INFINITY }, { inputTokens: 1, outputTokens: 1 })).toEqual({
      status: "unavailable",
      reason: "invalid_price",
    });
  });

  it("fails closed for invalid usage and makes budget decisions explicit", () => {
    const estimate = estimateProviderCost(PRICE_TABLE, { inputTokens: 1_500_000, outputTokens: 500_000 });
    expect(estimateProviderCost(PRICE_TABLE, { inputTokens: -1, outputTokens: 1 })).toEqual({
      status: "unavailable",
      reason: "invalid_usage",
    });
    expect(decideProviderBudget(estimate, { ceilingUsd: 10, confirmationThresholdUsd: 4 })).toEqual({
      decision: "confirm",
      reason: "confirmation_threshold_reached",
    });
    expect(decideProviderBudget(estimate, { ceilingUsd: 4, confirmationThresholdUsd: null })).toEqual({
      decision: "deny",
      reason: "budget_ceiling_exceeded",
    });
    expect(decideProviderBudget({ status: "unavailable", reason: "missing_price" }, {
      ceilingUsd: null,
      confirmationThresholdUsd: null,
    })).toEqual({ decision: "deny", reason: "estimate_unavailable" });
    expect(decideProviderBudget(estimate, null)).toEqual({ decision: "deny", reason: "invalid_policy" });
  });

  it("keeps browser preview provider state read-only", () => {
    expect(providerPreviewCopy()).toContain("Browser preview");
    expect(providerPreviewCopy()).toContain("does not configure credentials");
    expect(providerPreviewCopy()).toContain("localStorage");
  });
});
