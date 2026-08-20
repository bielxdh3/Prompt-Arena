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

export function isDesktopEnvironment(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function readAppStatus(): Promise<AppStatus> {
  if (!isDesktopEnvironment()) {
    throw new Error("The desktop bridge is unavailable in browser preview.");
  }

  try {
    return await invoke<AppStatus>("app_status");
  } catch {
    throw new Error("The local app status command could not be reached.");
  }
}

export async function readRuns(): Promise<RunRecord[]> {
  if (!isDesktopEnvironment()) {
    throw new Error("Runs are available only in the local desktop workspace.");
  }

  try {
    return await invoke<RunRecord[]>("list_runs");
  } catch {
    throw new Error("The local run history could not be reached.");
  }
}
