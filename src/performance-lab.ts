import type { PersistedExecution } from "./bridge";

export type MetricEvidence<T extends number | null = number | null> = {
  value: T;
  unit: string;
  source: string;
  samplingMethod: "runtime" | "os_counter" | "derived" | "unavailable";
  samplingIntervalMs: number | null;
  state: "observed" | "estimated" | "unavailable";
  confidence: "high" | "medium" | "low" | "unavailable";
  temperature: "cold" | "warm" | "unknown";
};

export type PerformanceEvidence = {
  schemaVersion: 1;
  metrics: Record<string, MetricEvidence>;
  temperature: "cold" | "warm" | "unknown";
};

// Implemented in the Performance Lab slice; kept as a declaration in the single-model base.
export type ExecutionMetricSource = (execution: PersistedExecution | null, temperature?: PerformanceEvidence["temperature"]) => PerformanceEvidence;
