export type RunCancellationResult = "queued" | "requested" | "already_finished" | "failed" | "already_requested";

/** Coordinates one cancellable UI operation and targets only its currently active one-shot run ID. */
export function createRunCancellationController() {
  let requested = false;
  let activeRunId: string | null = null;

  return {
    begin() {
      requested = false;
      activeRunId = null;
    },
    shouldContinue() {
      return !requested;
    },
    isRequested() {
      return requested;
    },
    setActive(runId: string) {
      activeRunId = runId;
    },
    clearActive(runId: string) {
      if (activeRunId === runId) activeRunId = null;
    },
    async request(cancel: (runId: string) => Promise<boolean>): Promise<RunCancellationResult> {
      if (requested) return "already_requested";
      requested = true;
      const runId = activeRunId;
      if (!runId) return "queued";
      try {
        return await cancel(runId) ? "requested" : "already_finished";
      } catch {
        return "failed";
      }
    },
  };
}
