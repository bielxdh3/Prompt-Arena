import { describe, expect, it } from "vitest";
import { canonicalJson, type JsonValue } from "./benchmark-domain";
import { EMPTY_DRAFT_FORM, formToDocument } from "./benchmark-authoring";
import type { BenchmarkVersion, ProfileRevision } from "./bridge";
import {
  arenaEmptyCopy,
  arenaPreviewCopy,
  arenaPreviewFromPlan,
  caseOptions,
  parseArenaDocument,
  profileOptions,
  taskOptions,
  versionOptions,
} from "./arena-ui";
import { buildRunPlan } from "./run-plan";

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

describe("bounded Arena UI helpers", () => {
  it("extracts sorted existing version and profile options without mutating records", () => {
    const versions = [
      { ...version().summary, versionId: "zeta@1", benchmarkId: "zeta" },
      version().summary,
    ];
    const profiles = [
      { ...profile(), profileId: "zeta", profileRevisionId: "zeta@1" },
      profile(),
    ];
    const versionIds = versions.map((item) => item.versionId);
    const profileIds = profiles.map((item) => item.profileRevisionId);

    expect(versionOptions(versions).map((item) => item.value)).toEqual(["logic@1", "zeta@1"]);
    expect(profileOptions(profiles).map((item) => item.value)).toEqual(["profile-1@1", "zeta@1"]);
    expect(versions.map((item) => item.versionId)).toEqual(versionIds);
    expect(profiles.map((item) => item.profileRevisionId)).toEqual(profileIds);
  });

  it("extracts task and case selections and reports honest empty states", () => {
    const document = parseArenaDocument(version().documentJson);

    expect(taskOptions(document)).toEqual([
      { value: "task-1", label: "Answer one", detail: "task-1" },
    ]);
    expect(caseOptions(document, "task-1")).toEqual([
      { value: "case-1", label: "case-1", detail: "Case prompt available" },
    ]);
    expect(caseOptions(document, "missing")).toEqual([]);
    expect(arenaEmptyCopy("versions")).toContain("does not invent");
    expect(arenaEmptyCopy("cases")).toContain("no usable case");
  });

  it("rejects malformed published documents", () => {
    expect(() => parseArenaDocument("not-json")).toThrow("malformed JSON");
    expect(() => parseArenaDocument(JSON.stringify({ schemaVersion: 1, kind: "other" }))).toThrow("unsupported");
    expect(() => parseArenaDocument(version().documentJson.replace('"task-1"', '"task/1"'))).toThrow("identifier");
  });

  it("keeps valid empty task and case arrays as honest empty states", () => {
    const emptyTasks = JSON.parse(version().documentJson) as Record<string, any>;
    emptyTasks.benchmarkVersion.tasks = [];
    const parsedEmptyTasks = parseArenaDocument(JSON.stringify(emptyTasks));
    expect(parsedEmptyTasks.tasks).toEqual([]);
    expect(taskOptions(parsedEmptyTasks)).toEqual([]);
    expect(arenaEmptyCopy("tasks")).toContain("no usable task");

    const emptyCases = JSON.parse(version().documentJson) as Record<string, any>;
    emptyCases.benchmarkVersion.tasks[0].cases = [];
    const parsedEmptyCases = parseArenaDocument(JSON.stringify(emptyCases));
    expect(parsedEmptyCases.tasks[0].cases).toEqual([]);
    expect(caseOptions(parsedEmptyCases, "task-1")).toEqual([]);
    expect(arenaEmptyCopy("cases")).toContain("no usable case");
  });

  it("keeps non-array task and case shapes malformed", () => {
    const malformedTasks = JSON.parse(version().documentJson) as Record<string, any>;
    malformedTasks.benchmarkVersion.tasks = {};
    expect(() => parseArenaDocument(JSON.stringify(malformedTasks))).toThrow("tasks are malformed");

    const malformedCases = JSON.parse(version().documentJson) as Record<string, any>;
    malformedCases.benchmarkVersion.tasks[0].cases = {};
    expect(() => parseArenaDocument(JSON.stringify(malformedCases))).toThrow("cases are malformed");
  });

  it("treats empty optional prompts as absent", () => {
    const document = JSON.parse(version().documentJson) as Record<string, any>;
    document.benchmarkVersion.tasks[0].systemPrompt = "  ";
    document.benchmarkVersion.tasks[0].cases[0].prompt = "";

    expect(parseArenaDocument(JSON.stringify(document))).toMatchObject({
      tasks: [{ systemPrompt: null, cases: [{ prompt: null }] }],
    });
  });

  it("produces a deterministic preview from the bounded run plan", () => {
    const benchmarkVersion = version();
    const plan = buildRunPlan({
      runId: "preview-run",
      version: benchmarkVersion,
      taskId: "task-1",
      caseId: "case-1",
      profileRevision: profile(),
    });

    expect(arenaPreviewFromPlan(plan, "task-1")).toEqual({
      benchmarkVersionId: "logic@1",
      taskId: "task-1",
      caseId: "case-1",
      profileRevisionId: "profile-1@1",
      model: "local-model",
      prompt: "Task prompt\n\nCase prompt",
      systemPrompt: "Profile system\n\nTask system",
      endpoint: "http://127.0.0.1:11434",
      repetitions: 1,
    });
  });

  it("keeps browser preview explicitly no-write", () => {
    expect(arenaPreviewCopy()).toContain("does not read desktop records");
    expect(arenaPreviewCopy()).toContain("does not create run state");
  });
});
