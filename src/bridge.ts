import { invoke } from "@tauri-apps/api/core";

export type StorageState = "contract_only";

export type AppStatus = {
  appName: string;
  protocolVersion: number;
  storageState: StorageState;
  supportedPlatform: "windows" | "linux" | "unsupported";
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
