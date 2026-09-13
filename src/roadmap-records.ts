/** Shared immutable roadmap-record contracts and bounded sanitization helpers. */
export const ROADMAP_FEATURE_KINDS = [
  "single_model_benchmark",
  "performance_lab",
  "historical_regression",
  "model_ratings",
  "robustness_arena",
  "repro_bundle",
] as const;
export type RoadmapFeatureKind = (typeof ROADMAP_FEATURE_KINDS)[number];

export type RoadmapRecord = {
  recordId: string;
  kind: RoadmapFeatureKind;
  payload: Record<string, unknown>;
  contentHash?: string;
  createdAt?: string;
};

export type RoadmapRecordRequest = {
  recordId: string;
  kind: RoadmapFeatureKind;
  payload: Record<string, unknown>;
};

const MAX_RECORD_BYTES = 1_048_576;
const SENSITIVE_KEY = /(api.?key|authorization|cookie|secret|password|private.?key|credential|auth.?header|access.?token|refresh.?token|session.?token|bearer)/iu;
const SAFE_ENVIRONMENT_KEYS = new Set(["promptArenaVersion", "platform", "runtimeVersion", "hardware", "os", "arch"]);

export function sanitizeRecord(value: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 16) throw new Error("Record is too deeply nested.");
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "environment" || key === "env") {
      if (child && typeof child === "object" && !Array.isArray(child)) {
        const safeEnvironment: Record<string, unknown> = {};
        for (const [environmentKey, environmentValue] of Object.entries(child as Record<string, unknown>)) {
          if (SAFE_ENVIRONMENT_KEYS.has(environmentKey)) safeEnvironment[environmentKey] = sanitizeValue(environmentValue, depth + 1);
        }
        output[key] = safeEnvironment;
      }
      continue;
    }
    if (SENSITIVE_KEY.test(key)) continue;
    output[key] = sanitizeValue(child, depth + 1);
  }
  return output;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 16) return null;
  if (Array.isArray(value)) return value.slice(0, 4096).map((child) => sanitizeValue(child, depth + 1));
  if (value && typeof value === "object") return sanitizeRecord(value as Record<string, unknown>, depth);
  if (typeof value === "string") return value.replace(/[\u0000-\u001F\u007F]/gu, " ").slice(0, 256 * 1024);
  return value;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export function roadmapRecordSize(request: RoadmapRecordRequest): number {
  return new TextEncoder().encode(canonicalJson(request.payload)).byteLength;
}

export function assertRoadmapRecord(request: RoadmapRecordRequest): void {
  if (!/^[A-Za-z0-9._-]{1,128}$/u.test(request.recordId)) throw new Error("Roadmap record ID is invalid.");
  if (!ROADMAP_FEATURE_KINDS.includes(request.kind)) throw new Error("Roadmap record kind is unsupported.");
  if (roadmapRecordSize(request) > MAX_RECORD_BYTES) throw new Error("Roadmap record exceeds the local metadata limit.");
}
