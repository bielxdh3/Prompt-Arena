import { describe, expect, it } from "vitest";
import type { HardwareSnapshot, ModelInfo } from "./bridge";
import {
  boundedRecommendationThresholds,
  classifyModelRecommendation,
  DEFAULT_RECOMMENDATION_THRESHOLDS,
  EMPTY_PROFILE_FORM,
  hardwarePreviewCopy,
  modelEmptyCopy,
  modelMetadataLabel,
  modelPreviewCopy,
  profilePreviewCopy,
  profileRevisionFromForm,
  profileRevisionIdPreview,
  stableProfileRevisionId,
} from "./model-library";

describe("model library profile boundary", () => {
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
    expect(modelEmptyCopy()).toContain("No catalog, download, or sample");
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
