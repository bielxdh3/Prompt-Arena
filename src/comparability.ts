import type { AttemptRecord, RunRecord } from "./bridge";
import { attemptStatusLabel, objectiveVerificationEvidence } from "./results-ui";

export type ComparabilityConfigurationState = "consistent" | "inconsistent" | "unavailable";

export type ComparabilityDimensions = {
  benchmarkVersionIdentity: "declared" | "missing";
  terminalStatus: {
    runTerminal: boolean;
    attemptsTerminal: boolean;
  };
  configurationConsistency: ComparabilityConfigurationState;
  completedAttemptCount: number;
  attemptCount: number;
  objectiveExactTextEvidence: {
    availableCount: number;
    requiredCount: number;
  };
};

export type DiagnosticObjectiveGroup = {
  rank: number;
  outcome: "passed" | "failed";
  relation: "ordered" | "tie";
  attemptIds: string[];
};

export type ComparabilityResult = {
  status: "ready" | "not_ready";
  label: "Diagnostic comparable" | "Not comparable";
  reasons: string[];
  dimensions: ComparabilityDimensions;
  objectiveDiagnostic: {
    label: "Diagnostic objective ordering/tie";
    groups: DiagnosticObjectiveGroup[];
  } | null;
};

function nonEmptyText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizedStatus(value: unknown): string {
  return typeof value === "string" ? attemptStatusLabel(value) : "Unknown";
}

function isTerminalStatus(value: unknown): boolean {
  return ["Completed", "Failed", "Cancelled"].includes(normalizedStatus(value));
}

function isCompletedStatus(value: unknown): boolean {
  return normalizedStatus(value) === "Completed";
}

type DeclaredConfiguration = {
  profileRevisionId: string;
  runtime: string;
  model: string;
};

function declaredConfiguration(attempt: AttemptRecord): DeclaredConfiguration | null {
  const profileRevisionId = nonEmptyText(attempt.profileRevisionId);
  const effectiveConfig = isRecord(attempt.effectiveConfig) ? attempt.effectiveConfig : null;
  const runtime = nonEmptyText(effectiveConfig?.runtime);
  const model = nonEmptyText(effectiveConfig?.model);
  const effectiveProfileRevisionId = nonEmptyText(effectiveConfig?.profileRevisionId);
  if (
    profileRevisionId === null ||
    runtime === null ||
    model === null ||
    (effectiveProfileRevisionId !== null && effectiveProfileRevisionId !== profileRevisionId)
  ) return null;
  return { profileRevisionId, runtime, model };
}

function configurationKey(configuration: DeclaredConfiguration): string {
  return JSON.stringify([
    configuration.profileRevisionId,
    configuration.runtime,
    configuration.model,
  ]);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function diagnosticObjectiveGroups(attempts: AttemptRecord[]): DiagnosticObjectiveGroup[] {
  const groups = new Map<boolean, string[]>();
  for (const attempt of [...attempts].sort((left, right) => compareStrings(left.attemptId, right.attemptId))) {
    const evidence = objectiveVerificationEvidence(attempt.result?.score);
    if (!evidence) continue;
    const attemptIds = groups.get(evidence.passed) ?? [];
    attemptIds.push(attempt.attemptId);
    groups.set(evidence.passed, attemptIds);
  }

  return [true, false]
    .filter((passed) => groups.has(passed))
    .map((passed, index) => {
      const attemptIds = groups.get(passed) ?? [];
      return {
        rank: index + 1,
        outcome: passed ? "passed" : "failed",
        relation: attemptIds.length > 1 ? "tie" : "ordered",
        attemptIds,
      };
    });
}

export function assessRunComparability(run: RunRecord, attempts: AttemptRecord[]): ComparabilityResult {
  const completedAttempts = attempts.filter((attempt) => isCompletedStatus(attempt.status));
  const evidence = completedAttempts.map((attempt) => objectiveVerificationEvidence(attempt.result?.score));
  const availableEvidenceCount = evidence.filter((value) => value !== null).length;
  const configurations = completedAttempts.map(declaredConfiguration);
  const configurationsAvailable = configurations.length > 0 && configurations.every((value) => value !== null);
  const configurationKeys = configurationsAvailable
    ? new Set(configurations.map((value) => configurationKey(value as DeclaredConfiguration)))
    : new Set<string>();
  const configurationConsistency: ComparabilityConfigurationState = configurationsAvailable
    ? configurationKeys.size === 1 ? "consistent" : "inconsistent"
    : "unavailable";
  const runTerminal = isTerminalStatus(run.status);
  const attemptsTerminal = attempts.every((attempt) => isTerminalStatus(attempt.status));
  const dimensions: ComparabilityDimensions = {
    benchmarkVersionIdentity: nonEmptyText(run.benchmarkVersionId) ? "declared" : "missing",
    terminalStatus: { runTerminal, attemptsTerminal },
    configurationConsistency,
    completedAttemptCount: completedAttempts.length,
    attemptCount: attempts.length,
    objectiveExactTextEvidence: {
      availableCount: availableEvidenceCount,
      requiredCount: completedAttempts.length,
    },
  };

  const reasons: string[] = [];
  if (dimensions.benchmarkVersionIdentity === "missing") {
    reasons.push("Benchmark version identity is missing.");
  }
  if (!runTerminal || !attemptsTerminal) {
    reasons.push("The run and every attempt must have a terminal status.");
  }
  if (completedAttempts.length === 0) {
    reasons.push("No completed attempts are available.");
  }
  if (configurationConsistency === "unavailable") {
    reasons.push("Completed attempts do not declare a complete profile/runtime/model configuration.");
  } else if (configurationConsistency === "inconsistent") {
    reasons.push("Completed attempts do not share one profile/runtime/model configuration.");
  }
  if (availableEvidenceCount !== completedAttempts.length) {
    reasons.push("Every completed attempt must have objective exact-text evidence.");
  }
  if (completedAttempts.some((attempt) => nonEmptyText(attempt.attemptId) === null)) {
    reasons.push("Completed attempts must have stable attempt identities.");
  }

  if (reasons.length > 0) {
    return {
      status: "not_ready",
      label: "Not comparable",
      reasons,
      dimensions,
      objectiveDiagnostic: null,
    };
  }

  return {
    status: "ready",
    label: "Diagnostic comparable",
    reasons: [],
    dimensions,
    objectiveDiagnostic: {
      label: "Diagnostic objective ordering/tie",
      groups: diagnosticObjectiveGroups(completedAttempts),
    },
  };
}
