import { describe, expect, it } from "vitest";
import { canonicalJson, type JsonValue } from "./benchmark-domain";
import { EMPTY_DRAFT_FORM, formToDocument } from "./benchmark-authoring";
import type { BenchmarkVersion, ProfileRevision } from "./bridge";
import {
  buildRunPlan,
  MAX_OBJECTIVE_EXPECTATION_BYTES,
  type BuildRunPlanInput,
} from "./run-plan";

function profile(): ProfileRevision {
  return {
    profileId: "profile-1",
    profileRevisionId: "profile-1@1",
    revision: 1,
    model: "local-model",
    runtime: "ollama",
    parameters: { temperature: 0.2 },
    systemPrompt: "Profile system",
  };
}

function version(): BenchmarkVersion {
  const document = formToDocument({
    ...EMPTY_DRAFT_FORM,
    benchmarkId: "logic",
    benchmarkName: "Logic",
    taskName: "Answer one",
    taskPrompt: "Task prompt",
    casePrompt: "Case prompt",
    rubricName: "Correctness",
    criterionName: "Correct",
  });
  document.benchmarkVersion.tasks[0].systemPrompt = "Task system";
  return {
    summary: {
      versionId: "logic@1",
      benchmarkId: "logic",
      versionNumber: 1,
      contentHash: "a".repeat(64),
      createdAt: "100",
    },
    documentJson: canonicalJson(document as unknown as JsonValue),
  };
}

function input(overrides: Partial<BuildRunPlanInput> = {}): BuildRunPlanInput {
  return {
    runId: "run-1",
    version: version(),
    taskId: "task-1",
    caseId: "case-1",
    profileRevision: profile(),
    ...overrides,
  };
}

function versionWithDocument(mutator: (document: Record<string, any>) => void): BenchmarkVersion {
  const current = version();
  const document = JSON.parse(current.documentJson) as Record<string, any>;
  mutator(document);
  return { ...current, documentJson: JSON.stringify(document) };
}

describe("bounded run-plan contract", () => {
  it("selects a real task/case and derives one fixed local Ollama plan", () => {
    const plan = buildRunPlan(input());

    expect(plan).toMatchObject({
      runId: "run-1",
      benchmarkVersionId: "logic@1",
      caseId: "case-1",
      runtimeConfig: {
        endpoint: "http://127.0.0.1:11434",
        connectTimeoutMs: 1500,
        readTimeoutMs: 500,
        readDeadlineMs: 600000,
      },
      generation: {
        model: "local-model",
        prompt: "Task prompt\n\nCase prompt",
        systemPrompt: "Profile system\n\nTask system",
      },
    });
    expect(plan.objectiveExpectation).toBeNull();
    expect(plan.generation.parameters).toMatchObject({ temperature: 0.2 });
    expect(plan.generation.parameters.topP).toBeNull();
  });

  it("carries only bounded text expectations outside the generation request", () => {
    const plan = buildRunPlan({
      ...input(),
      version: versionWithDocument((document) => {
        document.benchmarkVersion.tasks[0].cases[0].expected = "  expected answer\r\n";
      }),
    });

    expect(plan.objectiveExpectation).toBe("  expected answer\r\n");
    expect(plan.generation.metadata).toEqual({});
    expect(JSON.stringify(plan.generation)).not.toContain("expected answer");
  });

  it("treats unsupported expectations as absent and rejects invalid or oversized text", () => {
    expect(buildRunPlan({
      ...input(),
      version: versionWithDocument((document) => {
        document.benchmarkVersion.tasks[0].cases[0].expected = { answer: "not supported" };
      }),
    }).objectiveExpectation).toBeNull();

    expect(() => buildRunPlan({
      ...input(),
      version: versionWithDocument((document) => {
        document.benchmarkVersion.tasks[0].cases[0].expected = "bad\0answer";
      }),
    })).toThrow("Objective expectation");

    expect(() => buildRunPlan({
      ...input(),
      version: versionWithDocument((document) => {
        document.benchmarkVersion.tasks[0].cases[0].expected = "x".repeat(MAX_OBJECTIVE_EXPECTATION_BYTES + 1);
      }),
    })).toThrow("Objective expectation");
  });

  it("rejects malformed identities, missing selections, and unsafe repetition bounds", () => {
    expect(() => buildRunPlan(input({ runId: "../run-1" }))).toThrow("Run ID");
    expect(() => buildRunPlan(input({ taskId: "missing" }))).toThrow("task identity");
    expect(() => buildRunPlan(input({ caseId: "missing" }))).toThrow("case identity");
    expect(() => buildRunPlan({
      ...input(),
      version: versionWithDocument((document) => {
        document.benchmark.benchmarkId = "";
      }),
    })).toThrow("Benchmark ID");
    expect(() => buildRunPlan({
      ...input(),
      version: versionWithDocument((document) => {
        document.benchmarkVersion.defaultRepetitions = 11;
      }),
    })).toThrow("between one and ten");
  });

  it("rejects empty prompts and profile identity/model violations", () => {
    expect(() => buildRunPlan({
      ...input(),
      version: versionWithDocument((document) => {
        document.benchmarkVersion.tasks[0].prompt = "  ";
      }),
    })).toThrow("Task prompt");
    expect(() => buildRunPlan({
      ...input(),
      profileRevision: { ...profile(), profileRevisionId: "profile-2@1" },
    })).toThrow("Profile revision identity");
    expect(() => buildRunPlan({
      ...input(),
      profileRevision: { ...profile(), model: "" },
    })).toThrow("Profile model");
    expect(() => buildRunPlan({
      ...input(),
      profileRevision: { ...profile(), runtime: "remote" },
    })).toThrow("unsupported");
  });

  it("accepts discovered OpenAI-compatible profiles and carries their endpoint", () => {
    for (const runtime of ["lm_studio", "llama_cpp"] as const) {
      const plan = buildRunPlan({
        ...input(),
        profileRevision: {
          ...profile(),
          runtime,
          endpoint: runtime === "lm_studio" ? "http://127.0.0.1:1234" : "http://127.0.0.1:8080",
          backend: runtime,
          sourceId: `${runtime}-source`,
        },
      });
      expect(plan.profileRevision.runtime).toBe(runtime);
      expect(plan.runtimeConfig.endpoint).toBe(
        runtime === "lm_studio" ? "http://127.0.0.1:1234" : "http://127.0.0.1:8080",
      );
    }
  });

  it("requires an explicit endpoint for non-Ollama local profiles", () => {
    expect(() => buildRunPlan({
      ...input(),
      profileRevision: { ...profile(), runtime: "lm_studio" },
    })).toThrow("loopback profile endpoint");
  });

  it("rejects unsafe profile parameters and oversized plan content", () => {
    for (const parameter of ["unknown", "presencePenalty", "frequencyPenalty"]) {
      expect(() => buildRunPlan({
        ...input(),
        profileRevision: { ...profile(), parameters: { [parameter]: true } },
      })).toThrow("unsupported");
    }
    expect(() => buildRunPlan({
      ...input(),
      profileRevision: { ...profile(), parameters: { temperature: Number.MAX_VALUE } },
    })).toThrow("temperature");
    expect(() => buildRunPlan({
      ...input(),
      version: versionWithDocument((document) => {
        document.benchmarkVersion.tasks[0].prompt = "x".repeat(256 * 1024);
      }),
    })).toThrow();
  });

  it("preserves bounded flattened profile fields without an extra wrapper", () => {
    const plan = buildRunPlan(input({
      profileRevision: {
        ...profile(),
        profileLabel: "kept",
        profileHints: { localOnly: true },
      },
    }));

    expect(plan.profileRevision).toMatchObject({
      profileLabel: "kept",
      profileHints: { localOnly: true },
    });
    expect(plan.profileRevision).not.toHaveProperty("extra");
  });

  it("rejects oversized or non-JSON flattened profile fields", () => {
    expect(() => buildRunPlan(input({
      profileRevision: { ...profile(), padding: "x".repeat(256 * 1024) },
    }))).toThrow("Profile extra fields");
    expect(() => buildRunPlan(input({
      profileRevision: { ...profile(), invalid: Number.NaN },
    }))).toThrow("Profile extra fields");
  });
});
