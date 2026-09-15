import {
  PROVIDER_CATALOG,
  decideProviderBudget,
  estimateProviderCost,
  MAX_BUDGET_USD,
  MAX_PRICE_USD_PER_MILLION_TOKENS,
  MAX_TOKEN_COUNT,
  type ProviderId,
  type BudgetDecision,
  type CostEstimate,
  type PriceTableSnapshot,
} from "./provider-foundation";
import type {
  CostPolicy,
  ExternalProviderId,
  IdentityConfidence,
  SecureStorageStatus,
  CredentialSource,
  PriceSnapshot,
} from "./bridge";
import { formatLocaleCurrency, formatLocaleNumber, translate } from "./i18n";

export const MAX_BYOK_PROMPT_BYTES = 64 * 1024;
export const MAX_BYOK_ENDPOINT_LENGTH = 2 * 1024;
export const MAX_BYOK_MODEL_LENGTH = 256;
export const MAX_BYOK_API_KEY_LENGTH = 2 * 1024;

export type ByokConfigurationDraft = {
  endpoint: string;
  model: string;
  apiKey: string;
};

export type ByokConfigurationField = keyof ByokConfigurationDraft;

export type ByokPriceSnapshotDraft = {
  modelId: string;
  capturedOn: string;
  inputUsdPerMillionTokens: string;
  outputUsdPerMillionTokens: string;
};

export type ByokPriceSnapshotField = keyof ByokPriceSnapshotDraft;

export type ByokBudgetDraft = {
  confirmationThresholdUsd: string;
  ceilingUsd: string;
};

export type ByokBudgetField = keyof ByokBudgetDraft;

export type ByokGenerationDraft = {
  prompt: string;
  maxOutputTokens: string;
  priceSnapshot: ByokPriceSnapshotDraft;
  networkConsent: boolean;
  costConfirmed: boolean;
};

export type ByokGenerationField =
  | "prompt"
  | "maxOutputTokens"
  | "priceSnapshot"
  | "networkConsent"
  | "costConfirmed"
  | "ceiling";

export type ByokValidation<Field extends string> = {
  valid: boolean;
  errors: Partial<Record<Field, string>>;
};

export type ByokBudgetValidation = ByokValidation<ByokBudgetField> & {
  policy: CostPolicy | null;
};

export type ByokPriceSnapshotValidation = ByokValidation<ByokPriceSnapshotField> & {
  snapshot: PriceSnapshot | null;
};

export type ByokGenerationValidation = ByokValidation<ByokGenerationField> & {
  snapshot: PriceSnapshot | null;
  inputTokens: number | null;
  maxOutputTokens: number | null;
  estimate: CostEstimate | null;
  budgetDecision: BudgetDecision | null;
};

function firstError(errors: Partial<Record<string, string>>): string {
  return Object.values(errors).find((message): message is string => Boolean(message))
    ?? "Check the highlighted fields and try again.";
}

function validModel(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_BYOK_MODEL_LENGTH
    && !/[\s\u0000-\u001f\u007f]/.test(value);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseRequiredRate(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_PRICE_USD_PER_MILLION_TOKENS
    ? parsed
    : null;
}

function parseOptionalBudget(value: string): number | null | undefined {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_BUDGET_USD ? parsed : undefined;
}

function parseOutputTokens(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= MAX_TOKEN_COUNT ? parsed : null;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function firstByokValidationError(errors: Partial<Record<string, string>>): string {
  return firstError(errors);
}

export function validateByokConfiguration(
  draft: ByokConfigurationDraft,
): ByokValidation<ByokConfigurationField> {
  const errors: Partial<Record<ByokConfigurationField, string>> = {};
  const endpoint = draft.endpoint.trim();
  if (
    !endpoint
    || endpoint !== draft.endpoint
    || endpoint.length > MAX_BYOK_ENDPOINT_LENGTH
    || /[\s\u0000-\u001f\u007f@?#\\]/.test(endpoint)
  ) {
    errors.endpoint = "Use an HTTPS endpoint without credentials, query strings, or fragments.";
  } else {
    try {
      const parsed = new URL(endpoint);
      if (parsed.protocol !== "https:" || !parsed.hostname) errors.endpoint = "Use a valid HTTPS endpoint.";
    } catch {
      errors.endpoint = "Use a valid HTTPS endpoint.";
    }
  }

  if (!validModel(draft.model)) errors.model = "Enter a model ID without spaces or control characters.";
  if (
    !draft.apiKey
    || draft.apiKey.length > MAX_BYOK_API_KEY_LENGTH
    || !/^[\x21-\x7e]+$/.test(draft.apiKey)
  ) {
    errors.apiKey = "Enter the provider key in the password field.";
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateByokBudget(
  draft: ByokBudgetDraft,
): ByokBudgetValidation {
  const errors: Partial<Record<ByokBudgetField, string>> = {};
  const confirmationThresholdUsd = parseOptionalBudget(draft.confirmationThresholdUsd);
  const ceilingUsd = parseOptionalBudget(draft.ceilingUsd);
  if (confirmationThresholdUsd === undefined) {
    errors.confirmationThresholdUsd = "Use a non-negative USD amount within the local limit.";
  }
  if (ceilingUsd === undefined) {
    errors.ceilingUsd = "Use a non-negative USD amount within the local limit.";
  }
  if (
    confirmationThresholdUsd !== undefined
    && ceilingUsd !== undefined
    && confirmationThresholdUsd !== null
    && ceilingUsd !== null
    && confirmationThresholdUsd > ceilingUsd
  ) {
    errors.confirmationThresholdUsd = "The confirmation threshold cannot exceed the hard ceiling.";
  }

  const valid = Object.keys(errors).length === 0;
  return {
    valid,
    errors,
    policy: valid ? { confirmationThresholdUsd: confirmationThresholdUsd ?? null, ceilingUsd: ceilingUsd ?? null } : null,
  };
}

export function validateByokPriceSnapshot(
  providerId: ExternalProviderId,
  configuredModel: string,
  draft: ByokPriceSnapshotDraft,
): ByokPriceSnapshotValidation {
  const errors: Partial<Record<ByokPriceSnapshotField, string>> = {};
  const modelId = draft.modelId.trim();
  if (!validModel(modelId) || modelId !== draft.modelId) {
    errors.modelId = "Use the configured model ID without spaces or control characters.";
  } else if (modelId !== configuredModel) {
    errors.modelId = "The price snapshot model must match the configured model.";
  }
  if (!validDate(draft.capturedOn)) errors.capturedOn = "Use a real snapshot date in YYYY-MM-DD format.";
  const inputRate = parseRequiredRate(draft.inputUsdPerMillionTokens);
  const outputRate = parseRequiredRate(draft.outputUsdPerMillionTokens);
  if (inputRate === null) errors.inputUsdPerMillionTokens = "Enter an input price in USD per million tokens.";
  if (outputRate === null) errors.outputUsdPerMillionTokens = "Enter an output price in USD per million tokens.";

  const valid = Object.keys(errors).length === 0;
  return {
    valid,
    errors,
    snapshot: valid
      ? {
          providerId,
          modelId,
          capturedOn: draft.capturedOn,
          currency: "USD",
          inputUsdPerMillionTokens: inputRate,
          outputUsdPerMillionTokens: outputRate,
        }
      : null,
  };
}

export function validateByokGeneration(
  providerId: ExternalProviderId,
  configuredModel: string,
  policy: CostPolicy | null,
  draft: ByokGenerationDraft,
): ByokGenerationValidation {
  const errors: Partial<Record<ByokGenerationField, string>> = {};
  const promptBytes = utf8ByteLength(draft.prompt);
  if (!draft.prompt.trim()) errors.prompt = "Enter a prompt to test the configured provider.";
  if (promptBytes > MAX_BYOK_PROMPT_BYTES) errors.prompt = "The prompt exceeds the local 64 KiB limit.";
  const maxOutputTokens = parseOutputTokens(draft.maxOutputTokens);
  if (maxOutputTokens === null) errors.maxOutputTokens = "Use an integer from 1 to 100,000,000.";
  if (!draft.networkConsent) errors.networkConsent = "Confirm the external network call before continuing.";

  const priceValidation = validateByokPriceSnapshot(providerId, configuredModel, draft.priceSnapshot);
  if (!priceValidation.valid) errors.priceSnapshot = firstError(priceValidation.errors);

  const snapshot = priceValidation.snapshot;
  const inputTokens = promptBytes <= MAX_BYOK_PROMPT_BYTES ? promptBytes : null;
  const estimate = snapshot && maxOutputTokens !== null && inputTokens !== null
    ? estimateProviderCost(snapshot as PriceTableSnapshot, { inputTokens, outputTokens: maxOutputTokens })
    : null;
  const budgetDecision = estimate
    ? decideProviderBudget(estimate, policy ?? { confirmationThresholdUsd: null, ceilingUsd: null })
    : null;

  if (budgetDecision?.decision === "deny") {
    errors.ceiling = budgetDecision.reason === "budget_ceiling_exceeded"
      ? "The estimated cost exceeds the configured hard ceiling."
      : "The cost estimate is unavailable; check the dated price snapshot.";
  }
  if (budgetDecision?.decision === "confirm" && !draft.costConfirmed) {
    errors.costConfirmed = "Confirm the estimated cost before making the external call.";
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    snapshot,
    inputTokens,
    maxOutputTokens,
    estimate,
    budgetDecision,
  };
}

export function providerLabel(providerId: ExternalProviderId): string {
  return PROVIDER_CATALOG.find((provider) => provider.id === providerId)?.label ?? providerId;
}

export function formatByokMoney(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) || value < 0
    ? translate("Not set")
    : formatLocaleCurrency(value, undefined, "USD", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
}

export function formatByokTokens(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isSafeInteger(value) || value < 0
    ? translate("Not recorded")
    : formatLocaleNumber(value, undefined, { maximumFractionDigits: 0 });
}

export function formatIdentityConfidence(value: IdentityConfidence | null | undefined): string {
  switch (value) {
    case "provider_reported": return "Provider reported";
    case "unverified": return "Unverified";
    default: return "Not available";
  }
}

export function formatStorageStatus(value: SecureStorageStatus | null | undefined): string {
  switch (value) {
    case "available": return "Available";
    case "unsupported": return "Unsupported";
    case "error": return "Error";
    default: return "Not available";
  }
}

export function formatCredentialSource(value: CredentialSource | null | undefined): string {
  switch (value) {
    case "os_secure_storage": return "OS secure storage";
    case "not_configured": return "Not configured";
    case "unavailable": return "Unavailable";
    default: return "Not available";
  }
}

export function formatByokDecision(value: "allow" | "confirm" | "deny" | "confirmation_required" | "ceiling_exceeded" | null | undefined): string {
  switch (value) {
    case "allow": return "Allowed";
    case "confirm":
    case "confirmation_required": return "Confirmation required";
    case "deny":
    case "ceiling_exceeded": return "Blocked by ceiling";
    default: return "Not available";
  }
}

export function byokErrorMessage(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  switch (code) {
    case "provider_storage_unsupported": return "Secure credential storage is unsupported on this platform.";
    case "provider_storage_unavailable": return "The operating system secure credential store is unavailable.";
    case "provider_storage_error": return "The operating system secure credential store reported an error.";
    case "provider_not_configured": return "Configure this provider before using it.";
    case "provider_configuration_invalid": return "The provider configuration or cost policy was rejected.";
    case "provider_credential_invalid": return "The provider key was rejected and was not retained.";
    case "provider_network_consent_required": return "Explicit external network consent is required.";
    case "provider_request_too_large": return "The request exceeds the local size limit.";
    case "provider_response_too_large": return "The provider response exceeds the local size limit.";
    case "provider_timeout": return "The provider request timed out.";
    case "provider_transport": return "The provider transport could not complete.";
    case "provider_authentication": return "The provider rejected authentication.";
    case "provider_remote": return "The provider rejected the request.";
    case "provider_malformed_response": return "The provider response was malformed.";
    case "provider_unsupported_parameter": return "The provider cannot honor the requested parameter.";
    case "provider_missing_usage": return "The provider did not report billable usage.";
    case "provider_invalid_usage": return "The provider reported invalid billable usage.";
    case "provider_missing_price": return "A dated price snapshot is required.";
    case "provider_invalid_price": return "The dated price snapshot is invalid.";
    case "provider_confirmation_required": return "Explicit cost confirmation is required.";
    case "provider_budget_ceiling_exceeded": return "The configured budget ceiling would be exceeded.";
    default: return "The provider action could not be completed. No secret was retained.";
  }
}

export function providerIds(): readonly ProviderId[] {
  return PROVIDER_CATALOG.map((provider) => provider.id);
}
