import { describe, expect, it } from "vitest";
import { canonicalJson, type JsonValue } from "./benchmark-domain";
import { EMPTY_DRAFT_FORM, formToDocument } from "./benchmark-authoring";
import type { BenchmarkVersion, ProfileRevision } from "./bridge";
import {
  buildRunPlan,
  MAX_OBJECTIVE_EXPECTATION_BYTES,
  type BuildRunPlanInput,
} from "./run-plan";
import { generatePerturbations } from "./robustness-arena";

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
    expect(plan.generation.parameters.reasoningEffort).toBeNull();
    expect(plan.generation.parameters.contextWindowTokens).toBeNull();
  });

  it("carries an explicit profile reasoning-off choice into the typed generation plan", () => {
    const plan = buildRunPlan(input({
      profileRevision: { ...profile(), parameters: { reasoningEffort: "none" } },
    }));

    expect(plan.profileRevision.parameters).toEqual({ reasoningEffort: "none" });
    expect(plan.generation.parameters.reasoningEffort).toBe("none");
  });

  it("carries a stored output-token budget into the immutable generation plan", () => {
    const plan = buildRunPlan(input({
      profileRevision: { ...profile(), parameters: { maxTokens: 4096 } },
    }));

    expect(plan.profileRevision.parameters).toEqual({ maxTokens: 4096 });
    expect(plan.generation.parameters.maxTokens).toBe(4096);
  });

  it("carries an Ollama context-window preference into the immutable generation plan", () => {
    const plan = buildRunPlan(input({
      profileRevision: { ...profile(), parameters: { contextWindowTokens: 8192 } },
    }));

    expect(plan.profileRevision.parameters).toEqual({ contextWindowTokens: 8192 });
    expect(plan.generation.parameters.contextWindowTokens).toBe(8192);
  });

  it("rejects a context-window override for runtimes without declared support", () => {
    for (const [runtime, endpoint] of [
      ["lm_studio", "http://127.0.0.1:1234"],
      ["llama_cpp", "http://127.0.0.1:8080"],
    ]) {
      expect(() => buildRunPlan(input({
        profileRevision: { ...profile(), runtime, endpoint, parameters: { contextWindowTokens: 8192 } },
      }))).toThrow("contextWindowTokens is unsupported");
    }
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

  it("derives robustness prompts from a versioned typed transformation request", () => {
    const [variant] = generatePerturbations("Task prompt\n\nCase prompt", null, "logic@1", 7, ["concise_wording"]);
    const plan = buildRunPlan(input({
      promptVariant: {
        version: variant.version,
        transformationType: variant.transformationType,
        seed: variant.seed,
        sourceTaskVersion: variant.sourceTaskVersion,
      },
    }));

    expect(plan.taskId).toBe("task-1");
    expect(plan.promptVariant).toEqual({
      version: "2",
      transformationType: "concise_wording",
      seed: 7,
      sourceTaskVersion: "logic@1",
    });
    expect(plan.generation.prompt).toBe(variant.prompt);
    expect(() => buildRunPlan(input({
      promptVariant: { ...plan.promptVariant!, sourceTaskVersion: "other@1" },
    }))).toThrow("source does not match");
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

  it("derives sandbox-required policy at every scope and rejects contradictory metadata", () => {
    const scopes = [
      (document: Record<string, any>) => { document.requiresSandbox = true; },
      (document: Record<string, any>) => { document.benchmarkVersion.requiresSandbox = true; },
      (document: Record<string, any>) => { document.benchmarkVersion.tasks[0].requiresSandbox = true; },
      (document: Record<string, any>) => { document.benchmarkVersion.tasks[0].cases[0].requiresSandbox = true; },
      (document: Record<string, any>) => { document.benchmarkVersion.execution = { requiresSandbox: true, sandboxStatus: "unavailable", notes: "Docker is required" }; },
    ];
    for (const [index, configure] of scopes.entries()) {
      const plan = buildRunPlan({ ...input(), version: versionWithDocument(configure) });
      expect(plan.executionBoundary).toMatchObject({
        kind: "docker_required",
        status: index === 4 ? "unavailable" : "required",
      });
      expect(plan.executionBoundary.reason).toBe(index === 4
        ? "Docker is required"
        : "Docker-backed text verification is required; host execution is prohibited.");
    }

    expect(() => buildRunPlan({
      ...input(),
      version: versionWithDocument((document) => {
        document.benchmarkVersion.tasks[0].executionBoundary = "text_generation";
        document.benchmarkVersion.tasks[0].cases[0].requiresSandbox = true;
      }),
    })).toThrow("execution policy");

    expect(() => buildRunPlan({
      ...input(),
      version: versionWithDocument((document) => {
        document.benchmarkVersion.tasks[0].cases[0].sandboxStatus = "unavailable";
      }),
    })).toThrow("execution policy");
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
    for (const maxTokens of [0, -1, 1.5, 32_769, 4_294_967_296]) {
      expect(() => buildRunPlan({
        ...input(),
        profileRevision: { ...profile(), parameters: { maxTokens } },
      })).toThrow("maxTokens");
    }
    for (const contextWindowTokens of [0, -1, 1.5, 32_769, 4_294_967_296]) {
      expect(() => buildRunPlan({
        ...input(),
        profileRevision: { ...profile(), parameters: { contextWindowTokens } },
      })).toThrow("contextWindowTokens");
    }
    expect(() => buildRunPlan({
      ...input(),
      profileRevision: {
        ...profile(),
        parameters: { reasoningEffort: "high" as unknown as "none" },
      },
    })).toThrow("reasoningEffort");
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

