import { describe, expect, it } from "vitest";
import { canonicalJson } from "./roadmap-records";
import { compareReproLocalIdentity, exportReproBundle, importReproBundle, matchesReproSource, reproRunRequest, REPRO_BUNDLE_SCHEMA_VERSION } from "./repro-bundle";

const benchmarkContentHash = "a".repeat(64);
const sourcePayload = () => ({
  schemaVersion: 2,
  kind: "single_model_benchmark",
  runId: "run-alpha",
  benchmarkVersionId: "logic@1",
  benchmarkContentHash,
  taskId: "reasoning",
  caseId: "case-1",
  profileRevision: { profileId: "profile-alpha", profileRevisionId: "profile-alpha@2", model: "alpha", runtime: "ollama", systemPrompt: "Answer carefully.", parameters: { temperature: 0.2 }, apiKey: "must-not-be-retained" },
});

async function legacyV1Bundle(payload: Record<string, unknown>): Promise<string> {
  const body = { schemaVersion: 1, kind: "prompt_arena_repro_bundle", payload };
  const canonical = canonicalJson(body);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return JSON.stringify({ ...body, integrity: { schemaVersion: 1, files: [{ path: "bundle.json", sha256, bytes: new TextEncoder().encode(canonical).byteLength }] } });
}

describe("repro bundle", () => {
  it("omits sensitive-keyed fields, retains profile prompts, and verifies integrity", async () => {
    const bundle = await exportReproBundle({ runId: "run-alpha", systemPrompt: "Private profile instruction", apiKey: "do-not-export", nested: { password: "secret" } });
    expect(bundle).not.toContain("do-not-export");
    expect(bundle).not.toContain("secret");
    expect(bundle).toContain("Private profile instruction");
    expect(JSON.parse(bundle).schemaVersion).toBe(REPRO_BUNDLE_SCHEMA_VERSION);
    const imported = await importReproBundle(bundle);
    expect(imported.integrityVerified).toBe(true);
    expect(imported.payload.runId).toBe("run-alpha");
  });

  it("requires the benchmark content hash and full sanitized profile snapshot to match a local source", () => {
    const payload = sourcePayload();
    const request = reproRunRequest(payload);
    expect(request).toEqual({
      sourceRunId: "run-alpha",
      benchmarkVersionId: "logic@1",
      benchmarkContentHash,
      taskId: "reasoning",
      caseId: "case-1",
      profileRevisionId: "profile-alpha@2",
      profileRevision: { profileId: "profile-alpha", profileRevisionId: "profile-alpha@2", model: "alpha", runtime: "ollama", systemPrompt: "Answer carefully.", parameters: { temperature: 0.2 } },
    });
    expect(JSON.stringify(request?.profileRevision)).not.toContain("must-not-be-retained");
    expect(request && matchesReproSource(request, payload)).toBe(true);
    expect(request && matchesReproSource(request, { ...payload, taskId: "other-task" })).toBe(false);
    expect(request && matchesReproSource(request, { ...payload, benchmarkContentHash: "b".repeat(64) })).toBe(false);
    expect(request && matchesReproSource(request, {
      ...payload,
      profileRevision: { ...payload.profileRevision, parameters: { temperature: 0.8 } },
    })).toBe(false);
    expect(reproRunRequest({ schemaVersion: 1, kind: "single_model_benchmark", runId: "../../outside" })).toBeNull();

    const comparison = request && compareReproLocalIdentity(request, {
      benchmarkVersionId: "logic@1",
      benchmarkContentHash: "b".repeat(64),
      profileRevision: { ...payload.profileRevision, parameters: { temperature: 0.8 } },
    });
    expect(comparison).toEqual({ matches: false, differences: ["benchmark_content_differs", "profile_configuration_differs"] });
  });

  it("integrity-verifies legacy v1 files but does not make identity-only payloads rerunnable", async () => {
    const payload = { schemaVersion: 1, kind: "single_model_benchmark", runId: "run-alpha", benchmarkVersionId: "logic@1", taskId: "reasoning", caseId: "case-1", profileRevision: { profileRevisionId: "profile-alpha@2" } };
    const imported = await importReproBundle(await legacyV1Bundle(payload));
    expect(imported.integrityVerified).toBe(true);
    expect(reproRunRequest(imported.payload)).toBeNull();
  });

  it("returns typed, bounded configuration differences for localized rendering", async () => {
    const payload = { ...sourcePayload(), hardware: { platform: "windows" } };
    const bundle = await exportReproBundle(payload);
    const imported = await importReproBundle(bundle, { availableRuntimes: [], availableModels: [], platform: "linux" });
    expect(imported.differences).toEqual([
      { kind: "runtime_unavailable", value: "ollama" },
      { kind: "model_unavailable", value: "alpha" },
      { kind: "hardware_platform_differs", source: "windows", current: "linux" },
    ]);
  });

  it("classifies invalid JSON with a stable import error code", async () => {
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
