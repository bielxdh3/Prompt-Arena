export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue | undefined };
type FutureField = JsonValue | undefined;

export type ArtifactRef = {
  artifactId: string;
  relativePath: string;
  schemaVersion: number;
  sha256?: string | null;
  [futureField: string]: FutureField;
};

export type BenchmarkCase = {
  caseId: string;
  prompt: string | null;
  expected: JsonValue | undefined;
  artifacts: ArtifactRef[];
  [futureField: string]: FutureField;
};

export type BenchmarkTask = {
  taskId: string;
  name: string;
  prompt: string;
  cases: BenchmarkCase[];
  rubricId?: string;
  difficulty?: number;
  systemPrompt?: string | null;
  context?: string | null;
  [futureField: string]: FutureField;
};

export type RubricCriterion = {
  criterionId: string;
  name: string;
  description?: string | null;
  weight: number;
  [futureField: string]: FutureField;
};

export type Rubric = {
  rubricId: string;
  name: string;
  criteria: RubricCriterion[];
  [futureField: string]: FutureField;
};

export type PackCategory = {
  categoryId: string;
  name: string;
  children: PackCategory[];
  [futureField: string]: FutureField;
};

export type Pack = {
  packId: string;
  name: string;
  description?: string | null;
  categories: PackCategory[];
  [futureField: string]: FutureField;
};

export type Benchmark = {
  benchmarkId: string;
  name: string;
  description?: string | null;
  [futureField: string]: FutureField;
};

export type BenchmarkVersion = {
  versionId: string;
  versionNumber: number;
  tasks: BenchmarkTask[];
  rubrics: Rubric[];
  defaultRepetitions: number;
  [futureField: string]: FutureField;
};

export type BenchmarkDocument = {
  schemaVersion: 1;
  kind: "benchmark";
  pack: Pack;
  benchmark: Benchmark;
  benchmarkVersion: BenchmarkVersion;
  [futureField: string]: FutureField;
};

export function stableBenchmarkVersionId(benchmarkId: string, versionNumber: number): string {
  if (!/^[A-Za-z0-9._-]+$/.test(benchmarkId) || versionNumber < 1) {
    throw new Error("Invalid benchmark version identity");
  }
  return `${benchmarkId}@${versionNumber}`;
}

export function canonicalizeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => {
          const child = value[key];
          return [key, child === undefined ? undefined : canonicalizeJson(child)] as const;
        }),
    );
  }
  return value;
}

export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalizeJson(value));
}

export function isBenchmarkDocument(value: unknown): value is BenchmarkDocument {
  if (value === null || typeof value !== "object") return false;
  const document = value as Partial<BenchmarkDocument>;
  return document.schemaVersion === 1
    && document.kind === "benchmark"
    && typeof document.pack === "object"
    && document.pack !== null
    && typeof document.benchmark === "object"
    && document.benchmark !== null
    && typeof document.benchmarkVersion === "object"
    && document.benchmarkVersion !== null;
}
