import { describe, expect, it } from "vitest";
import { canonicalJson } from "./roadmap-records";
import {
  canReproRunWithLocalIdentity,
  compareReproLocalIdentity,
  decodeReproBenchmarkDocumentChunks,
  encodeReproBenchmarkDocumentChunks,
  exportReproBundle,
  importReproBundle,
  MAX_REPRO_BUNDLE_BYTES,
  MAX_REPRO_RESPONSE_OUTPUT_BYTES,
  matchesReproSource,
  reproModelArtifactFromProfile,
  reproRunRequest,
  REPRO_BUNDLE_SCHEMA_VERSION,
  verifyReproBenchmarkSnapshot,
} from "./repro-bundle";

const modelDigest = `sha256:${"b".repeat(64)}`;
const benchmarkDocument = {
  schemaVersion: 1,
  kind: "benchmark",
  pack: { packId: "pack-alpha", name: "Pack Alpha", categories: [] },
  benchmark: { benchmarkId: "logic", name: "Logic" },
  benchmarkVersion: {
    versionId: "logic@1",
    versionNumber: 1,
    defaultRepetitions: 1,
    tasks: [{
      taskId: "reasoning",
      name: "Reasoning",
      prompt: "Solve the problem.",
      cases: [{ caseId: "case-1", prompt: null, expected: "42", artifacts: [] }],
    }],
    rubrics: [],
  },
};

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sourcePayload() {
  const benchmarkContentHash = await sha256(canonicalJson(benchmarkDocument));
  const profileRevision = {
    profileId: "profile-alpha",
    profileRevisionId: "profile-alpha@2",
    revision: 2,
    model: "alpha",
    runtime: "ollama",
    backend: "ollama",
    modelId: "model-alpha",
    sourceId: "source-alpha",
    modelDigest,
    modelContentHash: null,
    quantizationLevel: "Q4_K_M",
    runtimeVersion: null,
    systemPrompt: "Answer carefully.",
    parameters: { temperature: 0.2, maxTokens: 128 },
  };
  return {
    schemaVersion: 2,
    kind: "single_model_benchmark",
    runId: "run-alpha",
    benchmarkVersionId: "logic@1",
    benchmarkContentHash,
    taskId: "reasoning",
    caseId: "case-1",
    profileRevision,
    reproductionSnapshot: {
      schemaVersion: 1,
      benchmark: { versionId: "logic@1", contentHash: benchmarkContentHash, documentJsonBase64Chunks: encodeReproBenchmarkDocumentChunks(canonicalJson(benchmarkDocument)) },
      modelArtifact: {
        modelId: "model-alpha",
        sourceId: "source-alpha",
        backend: "ollama",
        model: "alpha",
        runtime: "ollama",
        digest: modelDigest,
        contentHash: null,
        quantizationLevel: "Q4_K_M",
        runtimeVersion: null,
      },
      executionControls: { seed: null, randomnessControl: "runtime_default_unseeded" },
    },
  };
}

async function bundleWithSchema(schemaVersion: 1 | 2 | 3, payload: Record<string, unknown>): Promise<string> {
  const body = { schemaVersion, kind: "prompt_arena_repro_bundle", payload };
  const canonical = canonicalJson(body);
  return JSON.stringify({
    ...body,
    integrity: { schemaVersion, files: [{ path: "bundle.json", sha256: await sha256(canonical), bytes: new TextEncoder().encode(canonical).byteLength }] },
  });
}

async function legacyV1Bundle(payload: Record<string, unknown>): Promise<string> {
  return bundleWithSchema(1, payload);
}

describe("repro bundle", () => {
  it("filters sensitive-keyed fields, retains profile prompts for review, and verifies integrity", async () => {
    const bundle = await exportReproBundle({ runId: "run-alpha", systemPrompt: "Private profile instruction", apiKey: "do-not-export", nested: { password: "secret" } });
    expect(bundle).not.toContain("do-not-export");
    expect(bundle).not.toContain("secret");
    expect(bundle).toContain("Private profile instruction");
    expect(JSON.parse(bundle).schemaVersion).toBe(REPRO_BUNDLE_SCHEMA_VERSION);
    const imported = await importReproBundle(bundle);
    expect(imported.integrityVerified).toBe(true);
    expect(imported.reproductionSnapshotVerified).toBe(false);
    expect(imported.payload.runId).toBe("run-alpha");
  });

  it("exports and verifies the exact saved response output while filtering credential-keyed fields", async () => {
    const payload = {
      ...await sourcePayload(),
      sourceRun: { runId: "run-alpha" },
      attempt: { attemptId: "attempt-alpha" },
    };
    const text = "The answer is 42.\nUnicode: café 🧪";
    const responseOutput = {
      runId: "run-alpha",
      attemptId: "attempt-alpha",
      byteCount: new TextEncoder().encode(text).byteLength,
      sha256: await sha256(text),
      text,
    };

    const serialized = await exportReproBundle({ ...payload, responseOutput, apiKey: "must-not-export" });
    const imported = await importReproBundle(serialized);

    expect(serialized).not.toContain("must-not-export");
    expect(imported.payload.responseOutput).toEqual(responseOutput);
    expect(imported.integrityVerified).toBe(true);
  });

  it("rejects an oversized, mismatched, or tampered response output snapshot", async () => {
    const payload = { ...await sourcePayload(), attempt: { attemptId: "attempt-alpha" } };
    const text = "saved response";
    const validOutput = {
      runId: "run-alpha",
      attemptId: "attempt-alpha",
      byteCount: new TextEncoder().encode(text).byteLength,
      sha256: await sha256(text),
      text,
    };

    await expect(exportReproBundle({ ...payload, responseOutput: { ...validOutput, byteCount: MAX_REPRO_RESPONSE_OUTPUT_BYTES + 1 } }))
      .rejects.toThrow("response output is incomplete");
    await expect(exportReproBundle({ ...payload, responseOutput: { ...validOutput, attemptId: "another-attempt" } }))
      .rejects.toThrow("response output is incomplete");

    const tampered = { ...payload, responseOutput: { ...validOutput, sha256: "c".repeat(64) } };
    await expect(importReproBundle(await bundleWithSchema(3, tampered)))
      .rejects.toMatchObject({ name: "ReproBundleImportError", code: "invalid_response_output" });

    const oversizedText = "x".repeat(MAX_REPRO_RESPONSE_OUTPUT_BYTES + 1);
    const oversized = {
      ...payload,
      responseOutput: {
        runId: "run-alpha",
        attemptId: "attempt-alpha",
        byteCount: new TextEncoder().encode(oversizedText).byteLength,
        sha256: await sha256(oversizedText),
        text: oversizedText,
      },
    };
    await expect(importReproBundle(await bundleWithSchema(3, oversized)))
      .rejects.toMatchObject({ name: "ReproBundleImportError", code: "invalid_response_output" });
  });

  it("continues to import older bundles that have no response output snapshot", async () => {
    const payload = { schemaVersion: 1, kind: "single_model_benchmark", runId: "run-alpha", benchmarkVersionId: "logic@1", taskId: "reasoning", caseId: "case-1", profileRevision: { profileRevisionId: "profile-alpha@2" } };
    const imported = await importReproBundle(await legacyV1Bundle(payload));

    expect(imported.integrityVerified).toBe(true);
    expect(imported.payload).toEqual(payload);
  });

  it("requires a hash-matching full benchmark snapshot and exact selected task/case", async () => {
    const payload = await sourcePayload();
    const request = await reproRunRequest(payload);
    expect(request).toMatchObject({
      sourceRunId: "run-alpha",
      benchmarkVersionId: "logic@1",
      benchmarkContentHash: payload.benchmarkContentHash,
      taskId: "reasoning",
      caseId: "case-1",
      profileRevisionId: "profile-alpha@2",
      benchmarkSnapshot: { versionId: "logic@1", contentHash: payload.benchmarkContentHash },
      modelArtifact: { modelId: "model-alpha", digest: modelDigest, quantizationLevel: "Q4_K_M" },
    });
    expect(request && decodeReproBenchmarkDocumentChunks(request.benchmarkSnapshot.documentJsonBase64Chunks)).toBe(canonicalJson(benchmarkDocument));
    expect(request && matchesReproSource(request, payload)).toBe(true);
    expect(request && matchesReproSource(request, { ...payload, taskId: "other-task" })).toBe(false);
    expect(request && await verifyReproBenchmarkSnapshot(request.benchmarkSnapshot, { ...request, taskId: "other-task" })).toBe(false);
    expect(await reproRunRequest({ ...payload, schemaVersion: 1 })).toBeNull();
    expect(await reproRunRequest({ ...payload, taskId: "missing-task" })).toBeNull();
    expect(await reproRunRequest({ ...payload, caseId: "missing-case" })).toBeNull();

    const profile = payload.profileRevision as Record<string, unknown>;
    const comparison = request && compareReproLocalIdentity(request, {
      benchmarkVersionId: "logic@1",
      benchmarkContentHash: "a".repeat(64),
      profileRevision: { ...profile, parameters: { temperature: 0.8 } },
      modelArtifact: reproModelArtifactFromProfile(profile),
    });
    expect(comparison).toEqual({ matches: false, differences: ["benchmark_content_differs", "profile_configuration_differs"] });
  });

  it("produces identical verified rerun inputs from repeated imports", async () => {
    const payload = await sourcePayload();
    const serialized = await exportReproBundle(payload);
    const firstImport = await importReproBundle(serialized);
    const secondImport = await importReproBundle(serialized);
    const firstRequest = await reproRunRequest(firstImport.payload);
    const secondRequest = await reproRunRequest(secondImport.payload);

    expect(firstImport.reproductionSnapshotVerified).toBe(true);
    expect(secondImport.reproductionSnapshotVerified).toBe(true);
    expect(secondRequest).toEqual(firstRequest);
    expect(firstRequest && await verifyReproBenchmarkSnapshot(firstRequest.benchmarkSnapshot, firstRequest)).toBe(true);
  });

  it("verifies and preserves Rust-canonical integral floats such as 1.0", async () => {
    const payload = await sourcePayload();
    const document = {
      ...benchmarkDocument,
      benchmarkVersion: {
        ...benchmarkDocument.benchmarkVersion,
        rubrics: [{ rubricId: "rubric-1", name: "Correctness", criteria: [{ criterionId: "correct", name: "Correct", description: null, weight: 1 }] }],
      },
    };
    const rustCanonicalDocument = canonicalJson(document).replace('"weight":1}', '"weight":1.0}');
    const benchmarkContentHash = await sha256(rustCanonicalDocument);
    payload.benchmarkContentHash = benchmarkContentHash;
    const snapshot = payload.reproductionSnapshot as { benchmark: { contentHash: string; documentJsonBase64Chunks: string[] } };
    snapshot.benchmark.contentHash = benchmarkContentHash;
    snapshot.benchmark.documentJsonBase64Chunks = encodeReproBenchmarkDocumentChunks(rustCanonicalDocument);

    const exported = await exportReproBundle(payload);
    const imported = await importReproBundle(exported);
    const request = await reproRunRequest(imported.payload);

    expect(imported.reproductionSnapshotVerified).toBe(true);
    expect(request && decodeReproBenchmarkDocumentChunks(request.benchmarkSnapshot.documentJsonBase64Chunks)).toBe(rustCanonicalDocument);
  });

  it("records unseeded randomness explicitly and marks unsupported seeded bundles", async () => {
    const payload = await sourcePayload();
    const unseeded = await reproRunRequest(payload);
    expect(unseeded?.executionControls).toEqual({ seed: null, randomnessControl: "runtime_default_unseeded" });

    const seededPayload = structuredClone(payload);
    const snapshot = seededPayload.reproductionSnapshot as { executionControls: { seed: number | null; randomnessControl: string } };
    snapshot.executionControls = { seed: 42, randomnessControl: "seeded" };
    const imported = await importReproBundle(await exportReproBundle(seededPayload));
    expect(imported.reproductionSnapshotVerified).toBe(true);
    expect(imported.differences).toContainEqual({ kind: "seed_control_unsupported" });
    expect((await reproRunRequest(imported.payload))?.executionControls).toEqual({ seed: 42, randomnessControl: "seeded" });
  });

  it("blocks reruns when the bundle or local profile has no verifiable model artifact hash", async () => {
    const payload = await sourcePayload();
    const request = await reproRunRequest(payload);
    expect(request).not.toBeNull();
    if (!request) return;
    const noHashArtifact = { ...request.modelArtifact!, digest: null, contentHash: null };
    const missingBundleHash = compareReproLocalIdentity({ ...request, modelArtifact: noHashArtifact }, {
      benchmarkVersionId: "logic@1",
      benchmarkContentHash: request.benchmarkContentHash,
      profileRevision: request.profileRevision,
      modelArtifact: noHashArtifact,
    });
    expect(missingBundleHash.matches).toBe(false);
    expect(missingBundleHash.differences).toContain("model_artifact_hash_unavailable");
    expect(missingBundleHash.differences).toContain("local_model_artifact_hash_unavailable");

    const missingLocalIdentity = compareReproLocalIdentity(request, {
      benchmarkVersionId: "logic@1",
      benchmarkContentHash: request.benchmarkContentHash,
      profileRevision: request.profileRevision,
      modelArtifact: null,
    });
    expect(missingLocalIdentity.matches).toBe(false);
    expect(missingLocalIdentity.differences).toContain("local_model_artifact_unavailable");
  });

  it("compares local model artifact identity and hash, not just the profile label", async () => {
    const payload = await sourcePayload();
    const request = await reproRunRequest(payload);
    expect(request).not.toBeNull();
    if (!request) return;
    const comparison = compareReproLocalIdentity(request, {
      benchmarkVersionId: request.benchmarkVersionId,
      benchmarkContentHash: request.benchmarkContentHash,
      profileRevision: request.profileRevision,
      modelArtifact: { ...request.modelArtifact!, digest: `sha256:${"c".repeat(64)}` },
    });
    expect(comparison.matches).toBe(false);
    expect(comparison.differences).toContain("model_artifact_hash_differs");
  });

  it("allows reconstruction only for a missing local benchmark with matching local profile and artifact", async () => {
    const payload = await sourcePayload();
    const request = await reproRunRequest(payload);
    expect(request).not.toBeNull();
    if (!request) return;
    const profile = request.profileRevision;
    const matchingArtifact = reproModelArtifactFromProfile(profile);
    const missingVersion = compareReproLocalIdentity(request, {
      benchmarkVersionId: null,
      benchmarkContentHash: null,
      profileRevision: profile,
      modelArtifact: matchingArtifact,
    });
    expect(canReproRunWithLocalIdentity(missingVersion, false)).toBe(true);
    expect(canReproRunWithLocalIdentity(missingVersion, true)).toBe(false);

    const differentProfile = compareReproLocalIdentity(request, {
      benchmarkVersionId: null,
      benchmarkContentHash: null,
      profileRevision: { ...profile, parameters: { temperature: 0.9 } },
      modelArtifact: matchingArtifact,
    });
    expect(canReproRunWithLocalIdentity(differentProfile, false)).toBe(false);
  });

  it("imports integrity-verified v1 evidence as read-only without inventing identity proof", async () => {
    const payload = { schemaVersion: 1, kind: "single_model_benchmark", runId: "run-alpha", benchmarkVersionId: "logic@1", taskId: "reasoning", caseId: "case-1", profileRevision: { profileRevisionId: "profile-alpha@2" } };
    const imported = await importReproBundle(await legacyV1Bundle(payload));
    expect(imported.integrityVerified).toBe(true);
    expect(imported.bundleSchemaVersion).toBe(3);
    expect(imported.schemaMigration).toEqual({
      sourceSchemaVersion: 1,
      targetSchemaVersion: 3,
      status: "envelope_migrated_only",
      payloadPreserved: true,
      legacySingleModelReadOnlyReason: "legacy_payload_has_no_v2_identity_proof",
    });
    expect(imported.payload).toEqual(payload);
    expect(imported.reproductionSnapshotVerified).toBe(false);
    expect(await reproRunRequest(imported.payload)).toBeNull();
  });

  it("imports v2 single-model records read-only when they lack portable definitions", async () => {
    const payload = { schemaVersion: 2, kind: "single_model_benchmark", runId: "run-alpha", benchmarkVersionId: "logic@1", benchmarkContentHash: "a".repeat(64), taskId: "reasoning", caseId: "case-1", profileRevision: { profileRevisionId: "profile-alpha@2" } };
    const imported = await importReproBundle(await bundleWithSchema(2, payload));
    expect(imported.schemaMigration).toEqual({
      sourceSchemaVersion: 2,
      targetSchemaVersion: 3,
      status: "envelope_migrated_only",
      payloadPreserved: true,
      legacySingleModelReadOnlyReason: "legacy_payload_has_no_portable_snapshot",
    });
    expect(imported.reproductionSnapshotVerified).toBe(false);
    expect(await reproRunRequest(imported.payload)).toBeNull();
  });

  it("rejects a changed benchmark snapshot even when the outer bundle manifest is recomputed", async () => {
    const payload = await sourcePayload();
    const tampered = structuredClone(payload);
    const snapshot = tampered.reproductionSnapshot as { benchmark: { documentJsonBase64Chunks: string[] } };
    snapshot.benchmark.documentJsonBase64Chunks[0] = "invalid";
    await expect(importReproBundle(await bundleWithSchema(3, tampered)))
      .rejects.toMatchObject({ name: "ReproBundleImportError", code: "invalid_reproduction_snapshot" });
  });

  it("rejects bundles whose integrity envelope would exceed the import size limit", async () => {
    const values = Array.from({ length: 32 }, () => "x".repeat(256_000));
    values.push("");
    const baseBody = canonicalJson({ schemaVersion: 3, kind: "prompt_arena_repro_bundle", payload: { values } });
    values[32] = "x".repeat(MAX_REPRO_BUNDLE_BYTES - new TextEncoder().encode(baseBody).byteLength - 16);

    await expect(exportReproBundle({ values })).rejects.toThrow("bounded export limit");
  });

  it("enforces the total bundle limit when a maximum-size response output is included", async () => {
    const payload = {
      ...await sourcePayload(),
      attempt: { attemptId: "attempt-alpha" },
      evidenceChunks: Array.from({ length: 17 }, () => "p".repeat(256 * 1024)),
    };
    const text = "r".repeat(MAX_REPRO_RESPONSE_OUTPUT_BYTES);
    const responseOutput = {
      runId: "run-alpha",
      attemptId: "attempt-alpha",
      byteCount: new TextEncoder().encode(text).byteLength,
      sha256: await sha256(text),
      text,
    };

    await expect(exportReproBundle({ ...payload, responseOutput }))
      .rejects.toThrow("bounded export limit");
  });

  it("checks the original manifest before applying v1 envelope migration", async () => {
    const exported = JSON.parse(await legacyV1Bundle({
      schemaVersion: 1,
      kind: "single_model_benchmark",
      runId: "run-alpha",
      profileRevision: { profileRevisionId: "profile-alpha@2" },
    })) as Record<string, any>;
    exported.payload.runId = "run-omega";

    await expect(importReproBundle(JSON.stringify(exported)))
      .rejects.toMatchObject({ name: "ReproBundleImportError", code: "integrity_mismatch" });
  });

  it("keeps legacy evidence unchanged when re-exported inside a v3 envelope", async () => {
    const payload = { schemaVersion: 1, kind: "single_model_benchmark", runId: "run-alpha", benchmarkVersionId: "logic@1", taskId: "reasoning", caseId: "case-1", profileRevision: { profileRevisionId: "profile-alpha@2" } };
    const importedV1 = await importReproBundle(await legacyV1Bundle(payload));
    const importedV3 = await importReproBundle(await exportReproBundle(importedV1.payload));

    expect(importedV3.bundleSchemaVersion).toBe(3);
    expect(importedV3.schemaMigration).toEqual({
      sourceSchemaVersion: 3,
      targetSchemaVersion: 3,
      status: "already_current",
      payloadPreserved: true,
      legacySingleModelReadOnlyReason: "legacy_payload_has_no_v2_identity_proof",
    });
    expect(importedV3.payload).toEqual(importedV1.payload);
    expect(await reproRunRequest(importedV3.payload)).toBeNull();
  });

  it("returns typed environment and missing-artifact differences", async () => {
    const source = await sourcePayload();
    const payload = { ...source, hardware: { platform: "windows" } };
    const imported = await importReproBundle(await exportReproBundle(payload), { availableRuntimes: [], availableModels: [], platform: "linux" });
    expect(imported.differences).toEqual([
      { kind: "runtime_unavailable", value: "ollama" },
      { kind: "model_unavailable", value: "alpha" },
      { kind: "runtime_version_unavailable" },
      { kind: "hardware_platform_differs", source: "windows", current: "linux" },
    ]);

    const noHash = structuredClone(source);
    const snapshot = noHash.reproductionSnapshot as { modelArtifact: Record<string, unknown> };
    snapshot.modelArtifact.digest = null;
    const profile = noHash.profileRevision as Record<string, unknown>;
    profile.modelDigest = null;
    const noHashImported = await importReproBundle(await exportReproBundle(noHash));
    expect(noHashImported.differences).toContainEqual({ kind: "model_artifact_hash_unavailable" });
  });

  it("classifies malformed JSON with a stable import error code", async () => {
    await expect(importReproBundle("{"))
      .rejects.toMatchObject({ name: "ReproBundleImportError", code: "malformed_json" });
  });

  it("rejects a manifest byte count that does not match its canonical bundle body", async () => {
    const exported = JSON.parse(await exportReproBundle({ runId: "run-alpha" })) as Record<string, any>;
    exported.integrity.files[0].bytes += 1;
    await expect(importReproBundle(JSON.stringify(exported)))
      .rejects.toMatchObject({ name: "ReproBundleImportError", code: "invalid_byte_count" });
  });
});
