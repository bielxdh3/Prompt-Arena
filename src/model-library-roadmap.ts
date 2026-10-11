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

/** A single linear pass replaces a full history scan for every catalog row.
 * Operations must be newest-first, with active operations before terminal history.
 */
type IndexedOperation = { operation: ModelOperation; position: number };

export function indexRecentModelOperations(operations: readonly ModelOperation[]): Map<string, IndexedOperation> {
  const index = new Map<string, IndexedOperation>();
  for (const [position, operation] of operations.entries()) {
    if (operation.modelId !== null) {
      const key = JSON.stringify(["model", operation.modelId]);
      if (!index.has(key)) index.set(key, { operation, position });
    }
    if (operation.kind === "download") {
      const key = JSON.stringify(["download", operation.sourceId, operation.modelName]);
      if (!index.has(key)) index.set(key, { operation, position });
    }
    if (operation.kind === "import" && operation.managedPath !== null) {
      const key = JSON.stringify(["import", operation.managedPath]);
      if (!index.has(key)) index.set(key, { operation, position });
    }
  }
  return index;
}

export function indexedModelOperation(model: ModelRecord, index: ReadonlyMap<string, IndexedOperation>): ModelOperation | null {
  const candidates = [
    index.get(JSON.stringify(["model", model.modelId])),
    index.get(JSON.stringify(["download", model.sourceId, model.name])),
    ...(model.managedPath ?? model.path ? [index.get(JSON.stringify(["import", model.managedPath ?? model.path]))] : []),
  ].filter((item): item is IndexedOperation => item !== undefined)
    .sort((left, right) => Number(isActiveInstall(right.operation)) - Number(isActiveInstall(left.operation)) || left.position - right.position);
  return candidates[0]?.operation ?? null;
}

/** Defensive de-duplication across the always-live and paged terminal sections. */
export function visibleModelOperationPage(
  active: readonly ModelOperation[],
  history: readonly ModelOperation[],
): ModelOperation[] {
  const seen = new Set<string>();
  return [...active, ...history].filter((operation) => {
    if (seen.has(operation.operationId)) return false;
    seen.add(operation.operationId);
    return true;
  });
}

/** Null from the displayed older page means the end, not a fallback to page zero. */
export function nextModelHistoryOffset(
  recentNextOffset: number | null,
  olderPage: { nextOffset: number | null } | null,
): number | null {
  return olderPage ? olderPage.nextOffset : recentNextOffset;
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
