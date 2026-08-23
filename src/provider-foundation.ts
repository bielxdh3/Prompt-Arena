export type ProviderId = "openai-compatible" | "openai" | "anthropic" | "gemini";
export type ProviderKind = "generic_openai_compatible" | "native";
export type ProviderCapabilityStatus = "not_wired" | "catalog_only" | "available";
export type ProviderTransportStatus = "external_network_not_wired" | "loopback_only" | "available";
export type CredentialSourceState = "not_configured" | "environment_pending" | "os_secure_storage_pending";
export type IdentityConfidence = "unverified" | "provider_reported" | "verified";

export type ProviderCatalogEntry = {
  readonly id: ProviderId;
  readonly label: string;
  readonly kind: ProviderKind;
  readonly transportStatus: ProviderTransportStatus;
  readonly credentialSource: CredentialSourceState;
  readonly identityConfidence: IdentityConfidence;
  readonly capabilities: {
    readonly execution: ProviderCapabilityStatus;
    readonly modelDiscovery: ProviderCapabilityStatus;
    readonly costEstimation: ProviderCapabilityStatus;
  };
};

export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    kind: "generic_openai_compatible",
    transportStatus: "external_network_not_wired",
    credentialSource: "not_configured",
    identityConfidence: "unverified",
    capabilities: { execution: "not_wired", modelDiscovery: "not_wired", costEstimation: "catalog_only" },
  },
  {
    id: "openai",
    label: "OpenAI",
    kind: "native",
    transportStatus: "external_network_not_wired",
    credentialSource: "not_configured",
    identityConfidence: "unverified",
    capabilities: { execution: "not_wired", modelDiscovery: "not_wired", costEstimation: "catalog_only" },
  },
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "native",
    transportStatus: "external_network_not_wired",
    credentialSource: "not_configured",
    identityConfidence: "unverified",
    capabilities: { execution: "not_wired", modelDiscovery: "not_wired", costEstimation: "catalog_only" },
  },
  {
    id: "gemini",
    label: "Gemini",
    kind: "native",
    transportStatus: "external_network_not_wired",
    credentialSource: "not_configured",
    identityConfidence: "unverified",
    capabilities: { execution: "not_wired", modelDiscovery: "not_wired", costEstimation: "catalog_only" },
  },
];

export const MAX_PROVIDER_MODEL_ID_LENGTH = 256;
export const TOKENS_PER_MILLION = 1_000_000;
export const MAX_TOKEN_COUNT = 100_000_000;
export const MAX_PRICE_USD_PER_MILLION_TOKENS = 1_000_000;
export const MAX_BUDGET_USD = 1_000_000_000;

export type ProviderSelection = {
  providerId: ProviderId;
  modelId: string | null;
  credentialSource: CredentialSourceState;
  identityConfidence: IdentityConfidence;
};

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && PROVIDER_CATALOG.some((provider) => provider.id === value);
}

function safeModelId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const modelId = value.trim();
  if (!modelId || modelId.length > MAX_PROVIDER_MODEL_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(modelId)) return null;
  return modelId;
}

export function getProviderCatalogEntry(providerId: string): ProviderCatalogEntry {
  return PROVIDER_CATALOG.find((provider) => provider.id === providerId) ?? PROVIDER_CATALOG[0];
}

export function normalizeProviderSelection(input: unknown): ProviderSelection {
  const source = asRecord(input);
  return {
    providerId: isProviderId(source.providerId) ? source.providerId : "openai-compatible",
    modelId: safeModelId(source.modelId),
    credentialSource: "not_configured",
    identityConfidence: "unverified",
  };
}

export type PriceTableSnapshot = {
  providerId: ProviderId;
  modelId: string;
  capturedOn: string;
  currency: "USD";
  inputUsdPerMillionTokens: number | null;
  outputUsdPerMillionTokens: number | null;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type CostEstimateUnavailableReason = "missing_price" | "invalid_price" | "invalid_usage";

export type CostEstimate =
  | {
      status: "estimated";
      providerId: ProviderId;
      modelId: string;
      capturedOn: string;
      inputCostUsd: number;
      outputCostUsd: number;
      totalCostUsd: number;
    }
  | {
      status: "unavailable";
      reason: CostEstimateUnavailableReason;
    };

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidRate(value: unknown): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= 0
    && value <= MAX_PRICE_USD_PER_MILLION_TOKENS;
}

function isValidTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TOKEN_COUNT;
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function estimateProviderCost(table: PriceTableSnapshot | null, usage: TokenUsage): CostEstimate {
  if (!isValidTokenCount(usage?.inputTokens) || !isValidTokenCount(usage?.outputTokens)) {
    return { status: "unavailable", reason: "invalid_usage" };
  }
  const modelId = table ? safeModelId(table.modelId) : null;
  if (!table || !isProviderId(table.providerId) || modelId === null || !isValidDate(table.capturedOn) || table.currency !== "USD") {
    return { status: "unavailable", reason: "invalid_price" };
  }
  if (table.inputUsdPerMillionTokens === null || table.outputUsdPerMillionTokens === null) {
    return { status: "unavailable", reason: "missing_price" };
  }
  if (!isValidRate(table.inputUsdPerMillionTokens) || !isValidRate(table.outputUsdPerMillionTokens)) {
    return { status: "unavailable", reason: "invalid_price" };
  }

  const inputCostUsd = (usage.inputTokens / TOKENS_PER_MILLION) * table.inputUsdPerMillionTokens;
  const outputCostUsd = (usage.outputTokens / TOKENS_PER_MILLION) * table.outputUsdPerMillionTokens;
  const totalCostUsd = inputCostUsd + outputCostUsd;
  if (![inputCostUsd, outputCostUsd, totalCostUsd].every(Number.isFinite)) {
    return { status: "unavailable", reason: "invalid_price" };
  }
  return {
    status: "estimated",
    providerId: table.providerId,
    modelId,
    capturedOn: table.capturedOn,
    inputCostUsd: roundUsd(inputCostUsd),
    outputCostUsd: roundUsd(outputCostUsd),
    totalCostUsd: roundUsd(totalCostUsd),
  };
}

export type BudgetPolicy = {
  ceilingUsd: number | null;
  confirmationThresholdUsd: number | null;
};

export const DEFAULT_BUDGET_POLICY: BudgetPolicy = {
  ceilingUsd: null,
  confirmationThresholdUsd: null,
};

export type BudgetDecision =
  | { decision: "allow"; reason: "within_ceiling" }
  | { decision: "confirm"; reason: "confirmation_threshold_reached" }
  | { decision: "deny"; reason: "estimate_unavailable" | "invalid_policy" | "budget_ceiling_exceeded" };

function isValidBudget(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_BUDGET_USD;
}

export function decideProviderBudget(estimate: CostEstimate, policy: BudgetPolicy | null = DEFAULT_BUDGET_POLICY): BudgetDecision {
  if (!estimate || estimate.status !== "estimated" || !isValidBudget(estimate.totalCostUsd)) {
    return { decision: "deny", reason: "estimate_unavailable" };
  }
  if (!policy) return { decision: "deny", reason: "invalid_policy" };
  if (policy.ceilingUsd !== null && !isValidBudget(policy.ceilingUsd)) return { decision: "deny", reason: "invalid_policy" };
  if (policy.confirmationThresholdUsd !== null && !isValidBudget(policy.confirmationThresholdUsd)) {
    return { decision: "deny", reason: "invalid_policy" };
  }
  if (policy.ceilingUsd !== null && estimate.totalCostUsd > policy.ceilingUsd) {
    return { decision: "deny", reason: "budget_ceiling_exceeded" };
  }
  if (policy.confirmationThresholdUsd !== null && estimate.totalCostUsd >= policy.confirmationThresholdUsd) {
    return { decision: "confirm", reason: "confirmation_threshold_reached" };
  }
  return { decision: "allow", reason: "within_ceiling" };
}

export function providerPreviewCopy(): string {
  return "Browser preview does not configure credentials, make provider network calls, or write localStorage/provider state.";
}
