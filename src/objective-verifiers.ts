export type ObjectiveVerifierPolicy =
  | { kind: "exact_text"; expected: string }
  | { kind: "numeric_tolerance"; expected: number; tolerance: number }
  | { kind: "json_schema"; expected: unknown; required?: string[] }
  | { kind: "classification"; expected: string }
  | { kind: "safe_pattern"; pattern: string }
  | { kind: "required_fields"; fields: string[] };

export type ObjectiveCheck = {
  passed: boolean;
  verifierKind: ObjectiveVerifierPolicy["kind"];
  reason: string;
};

const MAX_POLICY_BYTES = 64 * 1024;
const MAX_PATTERN_BYTES = 4096;
const MAX_REQUIRED_FIELDS = 32;

export function verifyObjective(policy: ObjectiveVerifierPolicy, actual: string): ObjectiveCheck {
  assertPolicy(policy);
  if (byteLength(actual) > MAX_POLICY_BYTES) throw new Error("Objective response exceeds the local verification bound.");
  switch (policy.kind) {
    case "exact_text":
      return result(policy.kind, normalize(actual) === normalize(policy.expected), "normalized text comparison");
    case "numeric_tolerance": {
      const value = Number(normalize(actual));
      const difference = Math.abs(value - policy.expected);
      return result(policy.kind, Number.isFinite(value) && difference <= policy.tolerance, `absolute difference ${difference}`);
    }
    case "classification":
      return result(policy.kind, normalize(actual).toLowerCase() === normalize(policy.expected).toLowerCase(), "case-insensitive label comparison");
    case "safe_pattern":
      return result(policy.kind, safePatternMatch(policy.pattern, actual), "bounded pattern match");
    case "required_fields": {
      let parsed: unknown;
      try { parsed = JSON.parse(actual) as unknown; } catch { return result(policy.kind, false, "response is not valid JSON"); }
      const missing = policy.fields.filter((field) => !hasPath(parsed, field));
      return result(policy.kind, missing.length === 0, missing.length === 0 ? "all required fields are present" : `missing: ${missing.join(", ")}`);
    }
    case "json_schema": {
      let parsed: unknown;
      try { parsed = JSON.parse(actual) as unknown; } catch { return result(policy.kind, false, "response is not valid JSON"); }
      const required = policy.required ?? (isRecord(policy.expected) && Array.isArray(policy.expected.required) ? policy.expected.required.filter((field): field is string => typeof field === "string") : []);
      const missing = required.filter((field) => !hasPath(parsed, field));
      return result(policy.kind, missing.length === 0, missing.length === 0 ? "bounded JSON shape accepted" : `missing: ${missing.join(", ")}`);
    }
  }
}

export function normalizeObjectivePolicy(value: unknown): ObjectiveVerifierPolicy | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  if (byteLength(JSON.stringify(value)) > MAX_POLICY_BYTES) throw new Error("Objective verifier policy is too large.");
  switch (value.kind) {
    case "exact_text": return typeof value.expected === "string" ? { kind: "exact_text", expected: value.expected } : null;
    case "numeric_tolerance": return typeof value.expected === "number" && typeof value.tolerance === "number" && Number.isFinite(value.expected) && Number.isFinite(value.tolerance) && value.tolerance >= 0 && value.tolerance <= 1_000_000 ? { kind: "numeric_tolerance", expected: value.expected, tolerance: value.tolerance } : null;
    case "classification": return typeof value.expected === "string" ? { kind: "classification", expected: value.expected } : null;
    case "safe_pattern": return typeof value.pattern === "string" && byteLength(value.pattern) <= MAX_PATTERN_BYTES ? { kind: "safe_pattern", pattern: value.pattern } : null;
    case "required_fields": return Array.isArray(value.fields) && value.fields.length <= MAX_REQUIRED_FIELDS && value.fields.every((field) => typeof field === "string" && field.length > 0) ? { kind: "required_fields", fields: value.fields } : null;
    case "json_schema": return { kind: "json_schema", expected: value.expected, required: Array.isArray(value.required) ? value.required.filter((field): field is string => typeof field === "string").slice(0, MAX_REQUIRED_FIELDS) : undefined };
    default: return null;
  }
}

function assertPolicy(policy: ObjectiveVerifierPolicy): void {
  if (byteLength(JSON.stringify(policy)) > MAX_POLICY_BYTES) throw new Error("Objective verifier policy is too large.");
  if (policy.kind === "numeric_tolerance" && (!Number.isFinite(policy.tolerance) || policy.tolerance < 0)) throw new Error("Numeric tolerance is invalid.");
  if (policy.kind === "safe_pattern" && byteLength(policy.pattern) > MAX_PATTERN_BYTES) throw new Error("Pattern is too large.");
  if (policy.kind === "required_fields" && policy.fields.length > MAX_REQUIRED_FIELDS) throw new Error("Too many required fields.");
}

function safePatternMatch(pattern: string, actual: string): boolean {
  if (byteLength(pattern) > MAX_PATTERN_BYTES || pattern.includes("\0")) return false;

  // Keep this verifier deliberately literal. Regex evaluation is not bounded by
  // the response size and can turn a user-supplied pattern into a ReDoS sink.
  const anchoredStart = pattern.startsWith("^");
  const anchoredEnd = pattern.endsWith("$");
  const literal = pattern.slice(anchoredStart ? 1 : 0, anchoredEnd ? -1 : undefined);
  if (
    !literal
    || literal.includes("^")
    || literal.includes("$")
    || /[\\.*+?()[\]{}|]/u.test(literal)
  ) return false;

  const normalizedActual = normalize(actual);
  const normalizedLiteral = normalize(literal);
  if (anchoredStart && anchoredEnd) return normalizedActual === normalizedLiteral;
  if (anchoredStart) return normalizedActual.startsWith(normalizedLiteral);
  if (anchoredEnd) return normalizedActual.endsWith(normalizedLiteral);
  return normalizedActual.includes(normalizedLiteral);
}

function hasPath(value: unknown, path: string): boolean {
  return path.split(".").every((part) => {
    if (!isRecord(value) || !Object.hasOwn(value, part)) return false;
    value = value[part];
    return true;
  });
}

function result(verifierKind: ObjectiveCheck["verifierKind"], passed: boolean, reason: string): ObjectiveCheck {
  return { passed, verifierKind, reason };
}

function normalize(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trim();
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
