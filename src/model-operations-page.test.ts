import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  MODEL_OPERATION_PAGE_SIZE,
  readModelOperationsPage,
  type ModelOperation,
  type ModelOperationsPage,
  type ModelRecord,
} from "./bridge";
import {
  deriveModelAvailability,
  indexedModelOperation,
  indexRecentModelOperations,
  nextModelHistoryOffset,
  visibleModelOperationPage,
} from "./model-library-roadmap";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

function operation(index: number, overrides: Partial<ModelOperation> = {}): ModelOperation {
  return {
    operationId: `op-${index}`,
    kind: "download",
    backend: "ollama",
    sourceId: "local",
    modelName: `model-${index}`,
    modelId: null,
    managedPath: null,
    status: "completed",
    bytesTotal: 1,
    bytesCompleted: 1,
    progressPercent: 100,
    contentHash: null,
    message: null,
    createdAt: String(index),
    updatedAt: String(index),
    ...overrides,
  };
}

function model(index: number, overrides: Partial<ModelRecord> = {}): ModelRecord {
  return {
    modelId: `model-id-${index}`,
    sourceId: "local",
    backend: "ollama",
    name: `model-${index}`,
    endpoint: "http://127.0.0.1:11434",
    path: null,
    availability: "unavailable",
    digest: null,
    contentHash: null,
    contentHashStatus: "not_available",
    sizeBytes: null,
    family: null,
    parameterSize: null,
    quantizationLevel: null,
    contextLength: null,
    modifiedAt: null,
    managed: false,
    managedPath: null,
    metadata: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  vi.mocked(invoke).mockReset();
});

afterEach(() => vi.unstubAllGlobals());

describe("bounded local model operations bridge", () => {
  it("requests only 100 terminal rows per page and retains active operations even past 250 records", async () => {
    const terminal = Array.from({ length: 250 }, (_, i) => operation(i)).reverse();
    const running = operation(999, { status: "running", bytesCompleted: 0, progressPercent: 30 });
    const requested: number[] = [];
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      expect(command).toBe("list_model_operations_page");
      const { limit, offset } = args as { limit: number; offset: number };
      expect(limit).toBe(100);
      requested.push(offset);
      const slice = terminal.slice(offset, offset + limit);
      return {
        active: [running],
        history: slice,
        nextOffset: offset + limit < terminal.length ? offset + limit : null,
      } satisfies ModelOperationsPage;
    });

    const first = await readModelOperationsPage();
    const second = await readModelOperationsPage(MODEL_OPERATION_PAGE_SIZE, first.nextOffset!);
    const third = await readModelOperationsPage(MODEL_OPERATION_PAGE_SIZE, second.nextOffset!);
    expect(requested).toEqual([0, 100, 200]);
    expect([first.history.length, second.history.length, third.history.length]).toEqual([100, 100, 50]);
    expect(third.nextOffset).toBeNull();
    expect([first, second, third].every((page) => page.active[0].operationId === running.operationId)).toBe(true);
    expect(visibleModelOperationPage(first.active, second.history)).toHaveLength(101);
    expect(deriveModelAvailability(model(999), indexedModelOperation(model(999), indexRecentModelOperations([
      ...first.active, ...first.history,
    ]))).actions).toEqual(["cancel"]);
  });

  it("transitions a cancelled operation from active to recent history without duplicate UI rows", () => {
    const running = operation(999, { status: "running" });
    const completed = operation(998);
    const activePage: ModelOperationsPage = { active: [running], history: [completed], nextOffset: null };
    const cancelledPage: ModelOperationsPage = {
      active: [],
      history: [operation(999, { status: "cancelled" }), completed],
      nextOffset: null,
    };
    expect(visibleModelOperationPage(activePage.active, activePage.history).map((entry) => entry.operationId)).toEqual(["op-999", "op-998"]);
    expect(visibleModelOperationPage(cancelledPage.active, cancelledPage.history).map((entry) => entry.status)).toEqual(["cancelled", "completed"]);
    expect(visibleModelOperationPage([running], [running, completed]).map((entry) => entry.operationId)).toEqual(["op-999", "op-998"]);
  });

  it("respects the final older page cursor even when newer activity arrives", () => {
    expect(nextModelHistoryOffset(100, null)).toBe(100);
    expect(nextModelHistoryOffset(100, { nextOffset: 200 })).toBe(200);
    expect(nextModelHistoryOffset(100, { nextOffset: null })).toBeNull();
  });

  it("rejects out-of-range page requests before invoking desktop storage", async () => {
    for (const [limit, offset] of [[0, 0], [101, 0], [100, -1], [100.5, 0], [100, 2 ** 32]]) {
      await expect(readModelOperationsPage(limit, offset)).rejects.toThrow("invalid");
    }
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("model lookup indexing", () => {
  it("prioritizes old active downloads over recent terminal attempts and isolates source identities", () => {
    const recentFailure = operation(11, { modelName: "alpha", status: "failed" });
    const otherSource = operation(10, { sourceId: "other", modelName: "alpha", status: "running" });
    const oldActive = operation(9, { modelName: "alpha", status: "running" });
    const index = indexRecentModelOperations([otherSource, oldActive, recentFailure]);
    const matched = indexedModelOperation(model(5, { name: "alpha" }), index);
    expect(matched?.operationId).toBe("op-9");
    expect(deriveModelAvailability(model(5, { name: "alpha" }), matched).actions).toEqual(["cancel"]);
  });

  it("uses bounded linear lookup rather than rescanning the operation history for every model", () => {
    const records = Array.from({ length: 25_000 }, (_, i) => operation(i));
    const start = performance.now();
    const index = indexRecentModelOperations(records);
    for (let i = 0; i < 2_000; i += 1) {
      expect(indexedModelOperation(model(i), index)?.operationId).toBe(`op-${i}`);
    }
    const elapsed = performance.now() - start;
    // A generous ceiling accommodates loaded CI while catching pathological nested history scans.
    expect(elapsed).toBeLessThan(5_000);
  });
});
