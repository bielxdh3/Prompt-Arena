import { describe, expect, it } from "vitest";
import type {
  HardwareSnapshot,
  ModelCatalog,
  ModelDuplicateGroup,
  ModelInfo,
  ModelOperation,
  ModelRecord,
} from "./bridge";
import {
  boundedRecommendationThresholds,
  buildDownloadModelOperationRequest,
  buildImportModelOperationRequest,
  buildRemoveModelOperationRequest,
  classifyModelRecommendation,
  DEFAULT_RECOMMENDATION_THRESHOLDS,
  EMPTY_PROFILE_FORM,
  filterModelCatalog,
  deriveModelAvailability,
  hardwarePreviewCopy,
  findModelOperation,
  isActiveModelOperation,
  modelActionLabel,
  modelAvailabilityLabel,
  modelBackendLabel,
  modelDuplicateEvidenceLabel,
  modelDuplicateGroupLabel,
  modelDownloadCapabilityLabel,
  modelEmptyCopy,
  modelMetadataLabel,
  modelOperationProgressLabel,
  modelOperationMessage,
  modelOperationStatusLabel,
  modelPreviewCopy,
  modelRecordMetadataValue,
  modelRecordQuantizationLabel,
  modelRemovalCapabilityLabel,
  modelSourceStatusLabel,
  profilePreviewCopy,
  profileRevisionFromForm,
  profileRevisionFromModel,
  profileRevisionIdPreview,
  stableProfileRevisionId,
  validateLoopbackEndpoint,
  validateManagedGgufPath,
} from "./model-library";

function modelRecord(overrides: Partial<ModelRecord> = {}): ModelRecord {
  return {
    modelId: "model-q4",
    sourceId: "ollama-source",
    backend: "ollama",
    name: "local-model",
    endpoint: "http://127.0.0.1:11434",
    path: null,
    availability: "available",
    digest: "sha256:model",
    contentHash: null,
    sizeBytes: 4_000,
    family: "llama",
    parameterSize: "7B",
    quantizationLevel: "Q4_K_M",
    contextLength: 8_192,
    modifiedAt: null,
    managed: false,
    managedPath: null,
    metadata: {},
    ...overrides,
  };
}

function modelCatalog(models: ModelRecord[], duplicateGroups: ModelDuplicateGroup[] = []): ModelCatalog {
  return {
    generatedAt: "2026-08-27T00:00:00Z",
    sources: [
      {
        sourceId: "ollama-source",
        backend: "ollama",
        label: "Ollama",
        endpoint: "http://127.0.0.1:11434",
        path: null,
        status: "available",
        message: null,
        models: models.filter((model) => model.sourceId === "ollama-source"),
      },
      {
        sourceId: "research-source",
        backend: "lm_studio",
        label: "Research LM Studio",
        endpoint: "http://127.0.0.1:1234",
        path: null,
        status: "available",
        message: null,
        models: models.filter((model) => model.sourceId === "research-source"),
      },
      {
        sourceId: "managed-source",
        backend: "llama_cpp",
        label: "Managed GGUF",
        endpoint: null,
        path: "models/local.gguf",
        status: "available",
        message: null,
        models: models.filter((model) => model.sourceId === "managed-source"),
      },
    ],
    models,
    duplicateGroups,
  };
}

function modelOperation(overrides: Partial<ModelOperation> = {}): ModelOperation {
  return {
    operationId: "operation-1",
    kind: "download",
    backend: "ollama",
    sourceId: "ollama-source",
    modelName: "local-model",
    modelId: null,
    managedPath: null,
    status: "running",
    bytesTotal: 2_048,
    bytesCompleted: 1_024,
    progressPercent: 50,
    contentHash: null,
    message: null,
    createdAt: "2026-08-27T00:00:00Z",
    updatedAt: "2026-08-27T00:00:01Z",
    ...overrides,
  };
}

describe("model library profile boundary", () => {
  it("filters the unified catalog by model and source labels", () => {
    const ollama = modelRecord({ modelId: "ollama-q4", name: "Qwen 7B" });
    const lmStudio = modelRecord({
      modelId: "lm-q8",
      sourceId: "research-source",
      backend: "lm_studio",
      endpoint: "http://127.0.0.1:1234",
      name: "Mistral 7B",
      quantizationLevel: "Q8_0",
    });
    const catalog = modelCatalog([ollama, lmStudio]);

    expect(filterModelCatalog(catalog, "research")).toEqual([lmStudio]);
    expect(filterModelCatalog(catalog, "lm studio")).toEqual([lmStudio]);
    expect(filterModelCatalog(catalog, "q8_0")).toEqual([lmStudio]);
    expect(filterModelCatalog(catalog, "")).toEqual([ollama, lmStudio]);
    expect(modelBackendLabel("lm_studio")).toBe("LM Studio");
    expect(modelSourceStatusLabel("unavailable")).toBe("Unavailable");
  });

  it("keeps loopback endpoints and managed GGUF paths bounded", () => {
    expect(validateLoopbackEndpoint(" http://[::1]:8080 ")).toBe("http://[::1]:8080");
    expect(validateLoopbackEndpoint("http://localhost:11434")).toBe("http://localhost:11434");
    expect(validateManagedGgufPath(" nested/model.GGUF ")).toBe("nested/model.GGUF");

    for (const endpoint of [
      "https://127.0.0.1:11434",
      "http://192.168.1.20:11434",
      "http://user:pass@127.0.0.1:11434",
      "http://127.0.0.1:11434/?remote=true",
      "http://127.0.0.1:0",
    ]) {
      expect(() => validateLoopbackEndpoint(endpoint)).toThrow();
    }
    for (const path of ["../model.gguf", "C:/model.gguf", "/model.gguf", "nested\\model.gguf", "model.bin"]) {
      expect(() => validateManagedGgufPath(path)).toThrow();
    }
  });

  it("builds bounded download, import, and managed removal requests", () => {
    const ollama = modelRecord({ name: "Qwen 7B", endpoint: " http://127.0.0.1:11434 " });
    expect(buildDownloadModelOperationRequest(" download-1 ", ollama)).toEqual({
      kind: "download",
      operationId: "download-1",
      endpoint: "http://127.0.0.1:11434",
      modelName: "Qwen 7B",
    });

    expect(buildImportModelOperationRequest("import-1", "models/qwen.gguf")).toEqual({
      kind: "import",
      operationId: "import-1",
      sourcePath: "models/qwen.gguf",
    });

    const managed = modelRecord({
      modelId: "managed-q4",
      sourceId: "managed-source",
      backend: "llama_cpp",
      endpoint: null,
      path: "models/qwen.gguf",
      managed: true,
      managedPath: "models/qwen.gguf",
    });
    expect(buildRemoveModelOperationRequest("remove-1", managed)).toEqual({
      kind: "remove",
      operationId: "remove-1",
      modelId: "managed-q4",
    });

    expect(() => buildDownloadModelOperationRequest("download-2", managed)).toThrow();
    expect(() => buildRemoveModelOperationRequest("remove-2", ollama)).toThrow();
    expect(() => buildRemoveModelOperationRequest("remove-3", { ...managed, managedPath: "../qwen.gguf" })).toThrow();
  });

  it("keeps duplicate evidence and quantization variants distinct", () => {
    const ollamaQ4 = modelRecord({ modelId: "ollama-q4", name: "Qwen 7B" });
    const lmStudioQ4 = modelRecord({
      modelId: "lm-q4",
      sourceId: "research-source",
      backend: "lm_studio",
      endpoint: "http://127.0.0.1:1234",
      name: "Qwen 7B",
    });
    const llamaQ8 = modelRecord({
      modelId: "llama-q8",
      sourceId: "managed-source",
      backend: "llama_cpp",
      endpoint: null,
      path: "models/qwen-q8.gguf",
      quantizationLevel: "Q8_0",
      managed: true,
      managedPath: "models/qwen-q8.gguf",
    });
    const duplicateGroup: ModelDuplicateGroup = {
      groupId: "duplicate-1",
      digest: "sha256:shared",
      contentHash: null,
      modelIds: [ollamaQ4.modelId, lmStudioQ4.modelId],
    };
    const catalog = modelCatalog([ollamaQ4, lmStudioQ4, llamaQ8], [duplicateGroup]);

    expect(filterModelCatalog(catalog, "")).toHaveLength(3);
    expect(filterModelCatalog(catalog, "q8_0")).toEqual([llamaQ8]);
    expect(modelRecordQuantizationLabel(ollamaQ4)).toBe("Q4_K_M");
    expect(modelRecordQuantizationLabel(llamaQ8)).toBe("Q8_0");
    expect(modelDuplicateGroupLabel(duplicateGroup, catalog.models)).toContain("Q4_K_M");
    expect(modelDuplicateGroupLabel(duplicateGroup, catalog.models)).not.toContain("Q8_0");
    expect(modelDuplicateEvidenceLabel(duplicateGroup)).toBe("Digest sha256:share…");
  });

  it("shows normalized optional metadata and explicit unknown values", () => {
    const model = modelRecord({
      metadata: {
        format: "gguf",
        license: "Apache-2.0",
        source: "Hugging Face",
        location: "models/qwen.gguf",
        nested: { value: true },
      },
    });
    expect(modelRecordMetadataValue(model, "format")).toBe("gguf");
    expect(modelRecordMetadataValue(model, "license")).toBe("Apache-2.0");
    expect(modelRecordMetadataValue(model, "source")).toBe("Hugging Face");
    expect(modelRecordMetadataValue(model, "location")).toBe("models/qwen.gguf");
    expect(modelRecordMetadataValue(modelRecord(), "format")).toBe("Not reported");
    expect(modelRecordMetadataValue(modelRecord(), "license")).toBe("Not reported");
    expect(modelRecordMetadataValue(modelRecord({ metadata: { format: { kind: "gguf" } } }), "format")).toBe("Not reported");
  });

  it("labels persisted operation progress without guessing missing values", () => {
    expect(modelOperationProgressLabel(modelOperation({ progressPercent: 42 }))).toBe("42%");
    expect(modelOperationProgressLabel(modelOperation({ progressPercent: null, bytesCompleted: 512, bytesTotal: 2_048 }))).toBe("512 / 2048 bytes");
    expect(modelOperationProgressLabel(modelOperation({ status: "queued", progressPercent: null, bytesCompleted: 0, bytesTotal: null }))).toBe("Queued");
    expect(modelOperationStatusLabel("cancelled")).toBe("Cancelled");
    expect(isActiveModelOperation(modelOperation({ status: "running" }))).toBe(true);
    expect(isActiveModelOperation(modelOperation({ status: "completed" }))).toBe(false);
  });

  it("derives installed, downloading, unavailable, and failed model actions from local evidence", () => {
    const installed = modelRecord();
    expect(deriveModelAvailability(installed)).toMatchObject({ state: "installed", actions: ["use"] });
    expect(deriveModelAvailability(installed, modelOperation({ status: "failed", message: "stale pull failure" }))).toMatchObject({ state: "installed", actions: ["use"] });

    const unavailable = modelRecord({ availability: "unavailable" });
    expect(deriveModelAvailability(unavailable)).toMatchObject({ state: "not_installed", actions: ["download"] });
    expect(deriveModelAvailability(unavailable, modelOperation({ status: "queued" }))).toMatchObject({ state: "downloading", actions: ["cancel"] });
    expect(deriveModelAvailability(unavailable, modelOperation({ status: "running" }))).toMatchObject({ state: "downloading", actions: ["cancel"] });
    expect(deriveModelAvailability(unavailable, modelOperation({ status: "cancelled" }))).toMatchObject({ state: "not_installed", actions: ["download"] });
    expect(deriveModelAvailability(unavailable, modelOperation({ status: "failed", message: "runtime\nfailed" }))).toMatchObject({ state: "failed", actions: ["retry"] });
    expect(deriveModelAvailability(unavailable, modelOperation({ status: "completed" }))).toMatchObject({ state: "not_installed", actions: ["download"] });
    expect(modelOperationMessage(modelOperation({ message: "  failure\nwith\tcontrol  " }))).toBe("failure with control");
    expect(modelOperationMessage(modelOperation({ message: null }))).toBeNull();

    expect(findModelOperation(installed, [modelOperation({ status: "completed" }), modelOperation({ operationId: "operation-2", status: "running" })])?.operationId).toBe("operation-2");
    expect(modelAvailabilityLabel("not_installed")).toBe("Not installed");
    expect(modelAvailabilityLabel("downloading")).toBe("Downloading");
    expect(modelAvailabilityLabel("installed")).toBe("Installed");
    expect(modelAvailabilityLabel("failed")).toBe("Failed");
    expect(modelActionLabel("download")).toBe("Download");
    expect(modelActionLabel("cancel")).toBe("Cancel");
    expect(modelActionLabel("use")).toBe("Use in profile");
    expect(modelActionLabel("remove")).toBe("Remove");
    expect(modelActionLabel("retry")).toBe("Retry");
  });

  it("keeps managed installed models removable without inventing downloads", () => {
    const managed = modelRecord({
      backend: "llama_cpp",
      endpoint: null,
      path: "models/model.gguf",
      managed: true,
      managedPath: "models/model.gguf",
    });
    expect(deriveModelAvailability(managed)).toMatchObject({ state: "installed", actions: ["use", "remove"] });
  });

  it("derives immutable profile revision identity and fixed runtime", () => {
    const revision = profileRevisionFromForm({
      profileId: " local-default ",
      revision: "2",
      model: "llama3.2:latest",
    });
    expect(stableProfileRevisionId("local-default", 2)).toBe("local-default@2");
    expect(revision).toMatchObject({
      profileId: "local-default",
      profileRevisionId: "local-default@2",
      revision: 2,
      model: "llama3.2:latest",
      runtime: "ollama",
    });
    expect(revision.parameters).toEqual({});
    expect(revision).not.toHaveProperty("extra");
  });

  it("constructs source-aware immutable profiles for discovered runtimes", () => {
    const form = { profileId: "discovered", revision: "3", model: "ignored" };
    const discovered = [
      modelRecord({ modelId: "ollama-q4", sourceId: "ollama-source", backend: "ollama" }),
      modelRecord({ modelId: "lm-q8", sourceId: "lm-source", backend: "lm_studio", endpoint: "http://127.0.0.1:1234", quantizationLevel: "Q8_0" }),
      modelRecord({ modelId: "gguf-q5", sourceId: "gguf-source", backend: "llama_cpp", endpoint: null, path: "models/model-q5.gguf", managed: true, managedPath: "models/model-q5.gguf", quantizationLevel: "Q5_K_M" }),
    ];

    expect(discovered.map((model) => profileRevisionFromModel(form, model))).toMatchObject([
      { profileRevisionId: "discovered@3", model: "local-model", runtime: "ollama", modelId: "ollama-q4", sourceId: "ollama-source", backend: "ollama", endpoint: "http://127.0.0.1:11434", path: null },
      { profileRevisionId: "discovered@3", model: "local-model", runtime: "lm_studio", modelId: "lm-q8", sourceId: "lm-source", backend: "lm_studio", endpoint: "http://127.0.0.1:1234", quantizationLevel: "Q8_0" },
      { profileRevisionId: "discovered@3", model: "local-model", runtime: "llama_cpp", modelId: "gguf-q5", sourceId: "gguf-source", backend: "llama_cpp", path: "models/model-q5.gguf", quantizationLevel: "Q5_K_M" },
    ]);
  });

  it("labels supported and unsupported model actions explicitly", () => {
    const ollama = modelRecord();
    const lmStudio = modelRecord({ backend: "lm_studio" });
    const managed = modelRecord({ backend: "llama_cpp", endpoint: null, path: "models/model.gguf", managed: true, managedPath: "models/model.gguf" });
    const unmanaged = modelRecord({ backend: "llama_cpp", endpoint: "http://127.0.0.1:8080", path: null });

    expect(modelDownloadCapabilityLabel(ollama)).toContain("supported");
    expect(modelDownloadCapabilityLabel(lmStudio)).toContain("unsupported");
    expect(modelDownloadCapabilityLabel(managed)).toContain("unsupported");
    expect(modelRemovalCapabilityLabel(managed)).toContain("supported");
    expect(modelRemovalCapabilityLabel(unmanaged)).toContain("unsupported");
    expect(modelRemovalCapabilityLabel(ollama)).toContain("unsupported");
  });

  it("keeps profile IDs, revisions, and model names bounded", () => {
    expect(() => profileRevisionFromForm(EMPTY_PROFILE_FORM)).toThrow();
    expect(() => stableProfileRevisionId("../profile", 1)).toThrow();
    expect(() => stableProfileRevisionId("profile", 0)).toThrow();
    expect(() => profileRevisionFromForm({
      profileId: "profile",
      revision: "1.5",
      model: "model",
    })).toThrow();
    expect(() => profileRevisionFromForm({
      profileId: "profile",
      revision: "1",
      model: "x".repeat(257),
    })).toThrow();
    expect(profileRevisionIdPreview({ ...EMPTY_PROFILE_FORM, profileId: "profile" })).toBe("profile@1");
  });

  it("keeps browser preview honest and without saved records", () => {
    expect(profilePreviewCopy()).toContain("does not list or register");
    expect(modelPreviewCopy()).toContain("does not query Ollama or invent");
    expect(hardwarePreviewCopy()).toContain("does not read or invent");
    expect(modelEmptyCopy()).toContain("Discovery reports installed local records only");
  });

  it("classifies model pressure deterministically from bounded local facts", () => {
    const model: ModelInfo = {
      name: "local-model",
      digest: null,
      sizeBytes: 4_000,
      modifiedAt: null,
      family: "test",
      parameterSize: null,
      quantizationLevel: null,
      contextLength: null,
      metadata: {},
    };
    const hardware: HardwareSnapshot = {
      platform: "linux",
      logicalCpuCount: { value: 8, status: "available", source: "stdlib", confidence: "high" },
      memoryBytes: { value: 8_000, status: "available", source: "linux_procfs", confidence: "high" },
      gpuName: { value: null, status: "unavailable", source: "not_detected", confidence: "unavailable" },
      vramBytes: { value: null, status: "unavailable", source: "not_detected", confidence: "unavailable" },
    };
    expect(classifyModelRecommendation(model, hardware).kind).toBe("ideal");
    expect(classifyModelRecommendation({ ...model, sizeBytes: 6_000 }, hardware).kind).toBe("acceptable");
    expect(classifyModelRecommendation({ ...model, sizeBytes: 7_000 }, hardware).kind).toBe("heavy");
    expect(classifyModelRecommendation(model, hardware)).toEqual(classifyModelRecommendation(model, hardware));
  });

  it("keeps missing telemetry explicit instead of guessing a recommendation", () => {
    const model = {
      name: "model",
      digest: null,
      sizeBytes: 1_000,
      modifiedAt: null,
      family: null,
      parameterSize: null,
      quantizationLevel: null,
      contextLength: null,
      metadata: {},
    } satisfies ModelInfo;
    const hardware = {
      platform: "windows",
      logicalCpuCount: { value: null, status: "unavailable", source: "stdlib", confidence: "unavailable" },
      memoryBytes: { value: null, status: "unavailable", source: "windows_kernel32", confidence: "unavailable" },
      gpuName: { value: null, status: "unavailable", source: "not_detected", confidence: "unavailable" },
      vramBytes: { value: null, status: "unavailable", source: "not_detected", confidence: "unavailable" },
    } satisfies HardwareSnapshot;
    expect(classifyModelRecommendation(model, hardware).kind).toBe("unavailable");
    expect(classifyModelRecommendation({ ...model, sizeBytes: null }, hardware).kind).toBe("unavailable");
  });

  it("bounds user thresholds and preserves their ordering", () => {
    expect(boundedRecommendationThresholds({ idealPercent: 0, acceptablePercent: 100 })).toEqual({
      idealPercent: 10,
      acceptablePercent: 90,
    });
    expect(boundedRecommendationThresholds({ idealPercent: 90, acceptablePercent: 10 })).toEqual({
      idealPercent: 89,
      acceptablePercent: 90,
    });
    expect(boundedRecommendationThresholds({ idealPercent: Number.NaN })).toEqual(DEFAULT_RECOMMENDATION_THRESHOLDS);
  });

  it("keeps newer or missing model metadata compatible", () => {
    const model = {
      name: "model",
      digest: null,
      sizeBytes: null,
      modifiedAt: null,
      family: "llama",
      parameterSize: null,
      quantizationLevel: null,
      contextLength: null,
      metadata: { futureField: true },
    } satisfies ModelInfo;
    expect(modelMetadataLabel(model)).toBe("llama");
    expect(modelMetadataLabel({ ...model, family: null })).toBe("Metadata not reported");
  });
});
