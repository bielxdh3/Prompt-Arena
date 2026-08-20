import { invoke } from "@tauri-apps/api/core";

export type StorageState = "local";

export type AppStatus = {
  appName: string;
  protocolVersion: number;
  storageState: StorageState;
  supportedPlatform: "windows" | "linux" | "unsupported";
};

export type RunRecord = {
  runId: string;
  benchmarkVersionId: string;
  profileRevisionIds: string[];
  status: string;
  startedAt: string;
  attemptIds: string[];
  environment: Record<string, unknown>;
  extra: Record<string, unknown>;
};

export type BenchmarkVersionSummary = {
  versionId: string;
  benchmarkId: string;
  versionNumber: number;
  contentHash: string;
  createdAt: string;
};

export type BenchmarkDraftSummary = {
  draftId: string;
  benchmarkId: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type BenchmarkDraft = BenchmarkDraftSummary & {
  documentJson: string;
};

export type BenchmarkValidationSummary = {
  schemaVersion: number;
  versionId: string;
  contentHash: string;
};

export type SaveBenchmarkDraftRequest = {
  draftId: string;
  benchmarkId: string;
  title: string;
  documentJson: string;
  expectedRevision: number;
};

export type SavedBenchmarkVersion = {
  summary: BenchmarkVersionSummary;
};

export function isDesktopEnvironment(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function bridgeError(error: unknown, fallback: string): Error {
  if (typeof error === "string" && error.trim()) return new Error(error);
  if (error !== null && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return new Error(message);
  }
  return new Error(fallback);
}

async function invokeDesktop<T>(command: string, fallback: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktopEnvironment()) {
    throw new Error("The desktop bridge is unavailable in browser preview.");
  }

  try {
    return args === undefined ? await invoke<T>(command) : await invoke<T>(command, args);
  } catch (error: unknown) {
    throw bridgeError(error, fallback);
  }
}

export async function readAppStatus(): Promise<AppStatus> {
  return invokeDesktop<AppStatus>("app_status", "The local app status command could not be reached.");
}

export async function readRuns(): Promise<RunRecord[]> {
  if (!isDesktopEnvironment()) throw new Error("Runs are available only in the local desktop workspace.");
  return invokeDesktop<RunRecord[]>("list_runs", "The local run history could not be reached.");
}

export async function readBenchmarkVersions(): Promise<BenchmarkVersionSummary[]> {
  return invokeDesktop<BenchmarkVersionSummary[]>(
    "list_benchmark_versions",
    "The local benchmark versions could not be reached.",
  );
}

export async function readBenchmarkDrafts(): Promise<BenchmarkDraftSummary[]> {
  return invokeDesktop<BenchmarkDraftSummary[]>(
    "list_benchmark_drafts",
    "The local benchmark drafts could not be reached.",
  );
}

export async function readBenchmarkDraft(draftId: string): Promise<BenchmarkDraft | null> {
  return invokeDesktop<BenchmarkDraft | null>(
    "get_benchmark_draft",
    "The selected local benchmark draft could not be reached.",
    { draftId },
  );
}

export async function saveBenchmarkDraft(request: SaveBenchmarkDraftRequest): Promise<BenchmarkDraft> {
  return invokeDesktop<BenchmarkDraft>(
    "save_benchmark_draft",
    "The local benchmark draft could not be saved.",
    { request },
  );
}

export async function validateBenchmarkDocument(documentJson: string): Promise<BenchmarkValidationSummary> {
  return invokeDesktop<BenchmarkValidationSummary>(
    "validate_benchmark_document",
    "The benchmark validation command could not be reached.",
    { document: documentJson },
  );
}

export async function publishBenchmarkDraft(draftId: string): Promise<SavedBenchmarkVersion> {
  return invokeDesktop<SavedBenchmarkVersion>(
    "publish_benchmark_draft",
    "The local benchmark draft could not be published.",
    { draftId },
  );
}
