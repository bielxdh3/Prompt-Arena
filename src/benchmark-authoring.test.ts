import { describe, expect, it } from "vitest";
import {
  documentJsonForDraft,
  documentToForm,
  EMPTY_DRAFT_FORM,
  formToDocument,
  MAX_DRAFT_DOCUMENT_BYTES,
  MAX_DRAFT_TITLE_BYTES,
  type DraftFormState,
} from "./benchmark-authoring";

function validForm(): DraftFormState {
  return {
    ...EMPTY_DRAFT_FORM,
    benchmarkId: "logic",
    benchmarkName: "Logic",
    taskName: "Answer one",
    taskPrompt: "Answer the prompt.",
    rubricName: "Correctness",
    criterionName: "Correct",
  };
}

describe("structured benchmark authoring", () => {
  it("builds a deterministic benchmark-v1 document without raw JSON input", () => {
    const document = formToDocument(validForm());
    expect(document.benchmarkVersion.versionId).toBe("logic@1");
    expect(document.benchmarkVersion.tasks[0].cases[0].artifacts).toEqual([]);
    expect(documentJsonForDraft(document)).toContain('"schemaVersion":1');
  });

  it("rejects missing required fields and non-portable ids", () => {
    expect(() => formToDocument(validForm())).not.toThrow();
    expect(() => formToDocument({ ...validForm(), benchmarkId: "logic/unsafe" })).toThrow(
      "Benchmark ID must use portable",
    );
    expect(() => formToDocument({ ...validForm(), taskPrompt: "" })).toThrow("Task prompt is required");
  });

  it("keeps expected answers text-only and enforces draft bounds", () => {
    const document = formToDocument(validForm());
    document.benchmarkVersion.tasks[0].cases[0].expected = { answer: "not supported here" };
    expect(() => documentToForm(document, "draft-1", 1)).toThrow("text expectations only");

    const oversizedDocument = formToDocument({
      ...validForm(),
      taskPrompt: "x".repeat(MAX_DRAFT_DOCUMENT_BYTES),
    });
    expect(() => documentJsonForDraft(oversizedDocument)).toThrow("256 KiB");
    expect(() => formToDocument({
      ...validForm(),
      benchmarkName: "x".repeat(MAX_DRAFT_TITLE_BYTES + 1),
    })).toThrow("256 UTF-8 bytes");
  });
});
