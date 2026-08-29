import type { ObjectiveVerificationEvidence } from "./bridge";
import { formatLocaleNumber, translate } from "./i18n";

export type AttemptStatusTone = "success" | "failure" | "neutral";

export function blindReviewHidesAttemptEvidence(status: string): boolean {
  switch (status.trim().toLowerCase()) {
    case "loading":
    case "preparing":
    case "prepared":
    case "empty":
    case "error":
      return true;
    case "idle":
    case "locked":
      return false;
    default:
      return true;
  }
}

export function blindEvaluationStatusLabel(status: string): string {
  switch (status.trim().toLowerCase()) {
    case "prepared":
      return "Ready for blind review";
    case "locked":
      return "Locked and read-only";
    case "empty":
      return "No eligible responses";
    default:
      return "Evaluation unavailable";
  }
}

export function blindEvaluationScoreLabel(score: number | null | undefined): string {
  return score !== null && score !== undefined && Number.isInteger(score) && score >= 1 && score <= 5
    ? `${score}/5`
    : "Not scored";
}

export function objectiveVerificationEvidence(value: unknown): ObjectiveVerificationEvidence | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const passed = candidate.passed;
  const expectedNormalizedByteCount = candidate.expectedNormalizedByteCount;
  const actualNormalizedByteCount = candidate.actualNormalizedByteCount;
  const expectedSha256 = candidate.expectedSha256;
  const actualSha256 = candidate.actualSha256;
  if (
    !isVerifierKind(candidate.verifierKind) ||
    typeof passed !== "boolean" ||
    !nonNegativeSafeInteger(expectedNormalizedByteCount) ||
    !nonNegativeSafeInteger(actualNormalizedByteCount) ||
    !sha256(expectedSha256) ||
    !sha256(actualSha256)
  ) return null;
  return {
    passed,
    verifierKind: candidate.verifierKind,
    expectedNormalizedByteCount,
    actualNormalizedByteCount,
    expectedSha256,
    actualSha256,
    ...(typeof candidate.reason === "string" ? { reason: candidate.reason } : {}),
    ...(isRecord(candidate.details) ? { details: candidate.details } : {}),
  };
}

function isVerifierKind(value: unknown): value is ObjectiveVerificationEvidence["verifierKind"] {
  return value === "exact_text"
    || value === "numeric_tolerance"
    || value === "json_schema"
    || value === "required_fields"
    || value === "classification"
    || value === "safe_pattern";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function sha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function attemptStatusLabel(status: string): string {
  switch (status.trim().toLowerCase()) {
    case "completed":
    case "succeeded":
    case "success":
      return "Completed";
    case "cancelled":
    case "canceled":
      return "Cancelled";
    case "failed":
    case "failure":
    case "error":
      return "Failed";
    default:
      return status.trim() || "Unknown";
  }
}

export function attemptStatusTone(status: string): AttemptStatusTone {
  switch (attemptStatusLabel(status)) {
    case "Completed":
      return "success";
    case "Failed":
      return "failure";
    default:
      return "neutral";
  }
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return translate("Not recorded");
  }
  return formatLocaleNumber(value, undefined, { maximumFractionDigits: 0 });
}

export function formatByteCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return translate("Not recorded");
  }
  if (value < 1024) return `${formatCount(value)} B`;
  if (value < 1024 ** 2) return `${formatLocaleNumber(value / 1024, undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KiB`;
  if (value < 1024 ** 3) return `${formatLocaleNumber(value / 1024 ** 2, undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MiB`;
  return `${formatLocaleNumber(value / 1024 ** 3, undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} GiB`;
}

export function formatDurationNs(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value < 0) {
    return translate("Not recorded");
  }
  if (value >= 1_000_000_000) return `${formatLocaleNumber(value / 1_000_000_000, undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s`;
  if (value >= 1_000_000) return `${formatLocaleNumber(value / 1_000_000, undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ms`;
  if (value >= 1_000) return `${formatLocaleNumber(value / 1_000, undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} μs`;
  return `${formatCount(value)} ns`;
}
