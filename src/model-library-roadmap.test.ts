import { describe, expect, it } from "vitest";
import { deriveModelAvailability, modelOperationMessage } from "./model-library-roadmap";
import type { ModelOperation, ModelRecord } from "./bridge";

const model = (overrides: Partial<ModelRecord> = {}): ModelRecord => ({
  modelId: "alpha", sourceId: "ollama-local", backend: "ollama", name: "alpha", endpoint: "http://127.0.0.1:11434", path: null,
  availability: "available", digest: null, contentHash: null, sizeBytes: null, family: null, parameterSize: null,
  quantizationLevel: null, contextLength: null, modifiedAt: null, managed: false, managedPath: null, metadata: {}, ...overrides,
});
const operation = (overrides: Partial<ModelOperation> = {}): ModelOperation => ({
  operationId: "op", kind: "download", backend: "ollama", sourceId: "ollama-local", modelName: "alpha", modelId: null,
  managedPath: null, status: "running", bytesTotal: null, bytesCompleted: 0, progressPercent: null, contentHash: null,
  message: null, createdAt: "2026-09-12T00:00:00Z", updatedAt: "2026-09-12T00:00:00Z", ...overrides,
});

describe("model library availability contracts", () => {
  it("keeps active installs cancellable and sanitizes operation messages", () => {
    expect(deriveModelAvailability(model({ availability: "unavailable" }), operation()).actions).toEqual(["cancel"]);
    expect(modelOperationMessage(operation({ message: " failure\nwith\tcontrol " }))).toBe("failure with control");
  });
});
