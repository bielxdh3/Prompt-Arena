import { describe, expect, it } from "vitest";
import {
  documentJsonForDraft,
  documentToForm,
  EMPTY_DRAFT_FORM,
  draftFieldErrorId,
  draftFieldId,
  formToDocument,
  isRequiredDraftField,
  MAX_DRAFT_DOCUMENT_BYTES,
  MAX_DRAFT_TITLE_BYTES,
  updateDraftFieldError,
  validateDraftForm,
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

  it("maps required fields and focuses the first invalid field in form order", () => {
    const validation = validateDraftForm(EMPTY_DRAFT_FORM);
    expect(validation.valid).toBe(false);
    expect(validation.firstInvalidField).toBe("benchmarkId");
    expect(validation.errors).toMatchObject({
      benchmarkId: "Benchmark ID is required.",
      benchmarkName: "Benchmark name is required.",
      taskName: "Task name is required.",
      taskPrompt: "Task prompt is required.",
      rubricName: "Rubric name is required.",
      criterionName: "Criterion name is required.",
    });
    expect(validation.errorCount).toBe(6);

    const next = updateDraftFieldError(validation, EMPTY_DRAFT_FORM, "benchmarkId", "logic");
    expect(next?.firstInvalidField).toBe("benchmarkName");
    expect(next?.errors.benchmarkId).toBeUndefined();
  });

  it("updates an edited field error and clears it only after the value is valid", () => {
    const form = { ...validForm(), benchmarkId: "bad/id" };
    const validation = validateDraftForm(form);
    expect(validation.errors.benchmarkId).toContain("portable");

    const stillInvalid = updateDraftFieldError(validation, form, "benchmarkId", "still/bad");
    expect(stillInvalid?.errors.benchmarkId).toContain("portable");

    const fixed = updateDraftFieldError(
      stillInvalid,
      { ...form, benchmarkId: "still/bad" },
      "benchmarkId",
      "logic",
    );
    expect(fixed).toBeNull();
  });

  it("keeps required markers and inline error identifiers deterministic", () => {
    expect(isRequiredDraftField("benchmarkId")).toBe(true);
    expect(isRequiredDraftField("casePrompt")).toBe(false);
    expect(draftFieldId("criterionWeight")).toBe("criterion-weight");
    expect(draftFieldErrorId("criterionWeight")).toBe("criterion-weight-error");
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
