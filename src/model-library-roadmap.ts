import type { ModelOperation, ModelRecord } from "./bridge";

/** Source-aware availability decisions reconstructed from the legacy model-library work. */
export type ModelAvailabilityState = "not_installed" | "downloading" | "installed" | "failed" | "unavailable";
export type ModelActionKind = "download" | "cancel" | "use" | "remove" | "retry";
export type ModelAvailabilityView = { state: ModelAvailabilityState; operation: ModelOperation | null; actions: ModelActionKind[] };

export function isActiveInstall(operation: ModelOperation): boolean {
  return (operation.kind === "download" || operation.kind === "import") && (operation.status === "queued" || operation.status === "running");
}

export function findModelOperation(model: ModelRecord, operations: readonly ModelOperation[]): ModelOperation | null {
  let latest: ModelOperation | null = null;
  for (let index = operations.length - 1; index >= 0; index -= 1) {
    const operation = operations[index];
    if (operation.modelId === model.modelId || (operation.kind === "download" && operation.sourceId === model.sourceId && operation.modelName === model.name) || (operation.kind === "import" && operation.managedPath !== null && operation.managedPath === (model.managedPath ?? model.path))) {
      latest ??= operation;
      if (isActiveInstall(operation)) return operation;
    }
  }
  return latest;
}

export function deriveModelAvailability(model: ModelRecord, operation: ModelOperation | null = null): ModelAvailabilityView {
  if (operation && isActiveInstall(operation)) return { state: "downloading", operation, actions: ["cancel"] };
  if (model.availability === "available") {
    if (model.backend === "llama_cpp" && model.endpoint === null) return { state: "unavailable", operation, actions: model.managed && model.managedPath !== null ? ["remove"] : [] };
    const actions: ModelActionKind[] = ["use"];
    if (model.backend === "llama_cpp" && model.managed && model.managedPath !== null) actions.push("remove");
    return { state: "installed", operation, actions };
  }
  if (operation?.status === "failed" && ((operation.kind === "download" && model.backend === "ollama" && model.endpoint !== null) || (operation.kind === "import" && operation.managedPath !== null))) return { state: "failed", operation, actions: ["retry"] };
  return { state: "not_installed", operation, actions: model.backend === "ollama" && model.endpoint !== null ? ["download"] : [] };
}

export function modelOperationMessage(operation: ModelOperation | null): string | null {
  if (!operation?.message) return null;
  const sanitized = operation.message.replace(/[\u0000-\u001F\u007F]/gu, " ").trim().slice(0, 512);
  return sanitized || null;
}
