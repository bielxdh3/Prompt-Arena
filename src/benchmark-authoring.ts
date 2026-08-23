import {
  canonicalJson,
  stableBenchmarkVersionId,
  type BenchmarkDocument,
  type JsonValue,
} from "./benchmark-domain";

export const MAX_DRAFT_DOCUMENT_BYTES = 256 * 1024;
export const MAX_DRAFT_TITLE_BYTES = 256;

export type DraftFormState = {
  draftId: string;
  expectedRevision: number;
  packId: string;
  packName: string;
  categoryId: string;
  categoryName: string;
  benchmarkId: string;
  benchmarkName: string;
  versionNumber: string;
  defaultRepetitions: string;
  taskId: string;
  taskName: string;
  taskPrompt: string;
  taskDifficulty: string;
  caseId: string;
  casePrompt: string;
  expected: string;
  rubricId: string;
  rubricName: string;
  criterionId: string;
  criterionName: string;
  criterionDescription: string;
  criterionWeight: string;
};

export const EMPTY_DRAFT_FORM: DraftFormState = {
  draftId: "",
  expectedRevision: 0,
  packId: "core",
  packName: "Core",
  categoryId: "reasoning",
  categoryName: "Reasoning",
  benchmarkId: "",
  benchmarkName: "",
  versionNumber: "1",
  defaultRepetitions: "1",
  taskId: "task-1",
  taskName: "",
  taskPrompt: "",
  taskDifficulty: "1",
  caseId: "case-1",
  casePrompt: "",
  expected: "",
  rubricId: "rubric-1",
  rubricName: "",
  criterionId: "criterion-1",
  criterionName: "",
  criterionDescription: "",
  criterionWeight: "1",
};

export type DraftField = Exclude<keyof DraftFormState, "draftId" | "expectedRevision">;

export type DraftFormValidation = {
  valid: boolean;
  errors: Partial<Record<DraftField, string>>;
  firstInvalidField: DraftField | null;
  errorCount: number;
};

const DRAFT_FIELD_ORDER: readonly DraftField[] = [
  "packId",
  "packName",
  "categoryId",
  "categoryName",
  "benchmarkId",
  "benchmarkName",
  "versionNumber",
  "defaultRepetitions",
  "taskId",
  "taskName",
  "taskDifficulty",
  "taskPrompt",
  "caseId",
  "casePrompt",
  "expected",
  "rubricId",
  "rubricName",
  "criterionId",
  "criterionName",
  "criterionDescription",
  "criterionWeight",
];

const REQUIRED_DRAFT_FIELDS: readonly DraftField[] = [
  "packId",
  "packName",
  "categoryId",
  "categoryName",
  "benchmarkId",
  "benchmarkName",
  "versionNumber",
  "defaultRepetitions",
  "taskId",
  "taskName",
  "taskPrompt",
  "caseId",
  "rubricId",
  "rubricName",
  "criterionId",
  "criterionName",
  "criterionWeight",
];

const DRAFT_FIELD_LABELS: Record<DraftField, string> = {
  packId: "Pack ID",
  packName: "Pack name",
  categoryId: "Category ID",
  categoryName: "Category name",
  benchmarkId: "Benchmark ID",
  benchmarkName: "Benchmark name",
  versionNumber: "Version number",
  defaultRepetitions: "Default repetitions",
  taskId: "Task ID",
  taskName: "Task name",
  taskDifficulty: "Difficulty",
  taskPrompt: "Task prompt",
  caseId: "Case ID",
  casePrompt: "Case prompt",
  expected: "Expected answer",
  rubricId: "Rubric ID",
  rubricName: "Rubric name",
  criterionId: "Criterion ID",
  criterionName: "Criterion name",
  criterionDescription: "Criterion description",
  criterionWeight: "Criterion weight",
};

export function isRequiredDraftField(field: DraftField): boolean {
  return REQUIRED_DRAFT_FIELDS.includes(field);
}

export function draftFieldId(field: DraftField): string {
  return field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

export function draftFieldErrorId(field: DraftField): string {
  return `${draftFieldId(field)}-error`;
}

function addDraftError(
  errors: Partial<Record<DraftField, string>>,
  field: DraftField,
  message: string,
): void {
  if (!errors[field]) errors[field] = message;
}

function isPortableIdentifier(value: string): boolean {
  return value.length <= 128 && /^[A-Za-z0-9._-]+$/.test(value);
}

function isPositiveInteger(value: string, maximum = 4_294_967_295): boolean {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= maximum;
}

export function validateDraftForm(form: DraftFormState): DraftFormValidation {
  const errors: Partial<Record<DraftField, string>> = {};
  for (const field of REQUIRED_DRAFT_FIELDS) {
    if (!form[field].trim()) addDraftError(errors, field, `${DRAFT_FIELD_LABELS[field]} is required.`);
  }

  for (const field of ["packId", "categoryId", "benchmarkId", "taskId", "caseId", "rubricId", "criterionId"] as const) {
    const value = form[field].trim();
    if (value && !isPortableIdentifier(value)) {
      addDraftError(errors, field, `${DRAFT_FIELD_LABELS[field]} must use portable letters, numbers, dots, dashes, or underscores.`);
    }
  }

  const benchmarkName = form.benchmarkName.trim();
  if (benchmarkName && (benchmarkName.includes("\0") || utf8ByteLength(benchmarkName) > MAX_DRAFT_TITLE_BYTES)) {
    addDraftError(errors, "benchmarkName", "Benchmark name must be at most 256 UTF-8 bytes and contain no null characters.");
  }

  for (const field of ["versionNumber", "defaultRepetitions"] as const) {
    const value = form[field].trim();
    if (value && !isPositiveInteger(value)) {
      addDraftError(errors, field, `${DRAFT_FIELD_LABELS[field]} must be a whole number between 1 and 4,294,967,295.`);
    }
  }

  const difficulty = form.taskDifficulty.trim();
  if (difficulty && !isPositiveInteger(difficulty, 5)) {
    addDraftError(errors, "taskDifficulty", "Difficulty must be a whole number between 1 and 5.");
  }

  const weight = form.criterionWeight.trim();
  if (weight) {
    const parsed = Number(weight);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1_000_000) {
      addDraftError(errors, "criterionWeight", "Criterion weight must be a positive number no greater than 1,000,000.");
    }
  }

  const firstInvalidField = DRAFT_FIELD_ORDER.find((field) => Boolean(errors[field])) ?? null;
  const errorCount = DRAFT_FIELD_ORDER.filter((field) => Boolean(errors[field])).length;
  return {
    valid: errorCount === 0,
    errors,
    firstInvalidField,
    errorCount,
  };
}

function validationFromErrors(
  errors: Partial<Record<DraftField, string>>,
): DraftFormValidation | null {
  const firstInvalidField = DRAFT_FIELD_ORDER.find((candidate) => Boolean(errors[candidate])) ?? null;
  const errorCount = DRAFT_FIELD_ORDER.filter((candidate) => Boolean(errors[candidate])).length;
  if (errorCount === 0) return null;
  return { valid: false, errors, firstInvalidField, errorCount };
}

export function updateDraftFieldError(
  validation: DraftFormValidation | null,
  form: DraftFormState,
  field: DraftField,
  value: string,
): DraftFormValidation | null {
  if (!validation) return null;
  const nextValidation = validateDraftForm({ ...form, [field]: value });
  const errors = { ...validation.errors };
  if (nextValidation.errors[field]) {
    errors[field] = nextValidation.errors[field];
  } else {
    delete errors[field];
  }
  return validationFromErrors(errors);
}

export function newDraftId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `draft-${crypto.randomUUID()}`;
  }
  return `draft-${Date.now().toString(36)}`;
}

function required(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

function identifier(value: string, label: string): string {
  const trimmed = required(value, label);
  if (trimmed.length > 128 || !/^[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new Error(`${label} must use portable letters, numbers, dots, dashes, or underscores.`);
  }
  return trimmed;
}

function positiveInteger(value: string, label: string, maximum = 4_294_967_295): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${label} must be a whole number between 1 and ${maximum}.`);
  }
  return parsed;
}

function optionalText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function draftTitle(value: string): string {
  const title = required(value, "Benchmark name");
  if (title.includes("\0") || utf8ByteLength(title) > MAX_DRAFT_TITLE_BYTES) {
    throw new Error("Benchmark name must be at most 256 UTF-8 bytes and contain no null characters.");
  }
  return title;
}

export function formToDocument(form: DraftFormState): BenchmarkDocument {
  const benchmarkId = identifier(form.benchmarkId, "Benchmark ID");
  const benchmarkName = draftTitle(form.benchmarkName);
  const versionNumber = positiveInteger(form.versionNumber, "Version number");
  const defaultRepetitions = positiveInteger(form.defaultRepetitions, "Default repetitions");
  const difficulty = form.taskDifficulty.trim()
    ? positiveInteger(form.taskDifficulty, "Difficulty", 5)
    : undefined;
  const weight = Number(form.criterionWeight);
  if (!Number.isFinite(weight) || weight <= 0 || weight > 1_000_000) {
    throw new Error("Criterion weight must be a positive number no greater than 1,000,000.");
  }

  return {
    schemaVersion: 1,
    kind: "benchmark",
    pack: {
      packId: identifier(form.packId, "Pack ID"),
      name: required(form.packName, "Pack name"),
      description: null,
      categories: [
        {
          categoryId: identifier(form.categoryId, "Category ID"),
          name: required(form.categoryName, "Category name"),
          children: [],
        },
      ],
    },
    benchmark: {
      benchmarkId,
      name: benchmarkName,
      description: null,
    },
    benchmarkVersion: {
      versionId: stableBenchmarkVersionId(benchmarkId, versionNumber),
      versionNumber,
      defaultRepetitions,
      tasks: [
        {
          taskId: identifier(form.taskId, "Task ID"),
          name: required(form.taskName, "Task name"),
          prompt: required(form.taskPrompt, "Task prompt"),
          cases: [
            {
              caseId: identifier(form.caseId, "Case ID"),
              prompt: optionalText(form.casePrompt),
              expected: optionalText(form.expected),
              artifacts: [],
            },
          ],
          rubricId: identifier(form.rubricId, "Rubric ID"),
          difficulty,
          systemPrompt: null,
          context: null,
        },
      ],
      rubrics: [
        {
          rubricId: identifier(form.rubricId, "Rubric ID"),
          name: required(form.rubricName, "Rubric name"),
          criteria: [
            {
              criterionId: identifier(form.criterionId, "Criterion ID"),
              name: required(form.criterionName, "Criterion name"),
              description: optionalText(form.criterionDescription),
              weight,
            },
          ],
        },
      ],
    },
  };
}

export function documentJsonForDraft(document: BenchmarkDocument): string {
  const canonical = canonicalJson(document as unknown as JsonValue);
  if (utf8ByteLength(canonical) > MAX_DRAFT_DOCUMENT_BYTES) {
    throw new Error("Benchmark draft document exceeds the 256 KiB limit.");
  }
  return canonical;
}

export function formTitle(form: DraftFormState): string {
  return draftTitle(form.benchmarkName);
}

export function documentToForm(
  document: BenchmarkDocument,
  draftId: string,
  expectedRevision: number,
): DraftFormState {
  const category = document.pack.categories[0];
  const task = document.benchmarkVersion.tasks[0];
  const benchmarkCase = task?.cases[0];
  const rubric = document.benchmarkVersion.rubrics[0];
  const criterion = rubric?.criteria[0];
  if (
    document.pack.categories.length !== 1
    || document.benchmarkVersion.tasks.length !== 1
    || task?.cases.length !== 1
    || document.benchmarkVersion.rubrics.length !== 1
    || rubric?.criteria.length !== 1
    || task?.rubricId !== rubric?.rubricId
    || !category
    || !task
    || !benchmarkCase
    || !rubric
    || !criterion
  ) {
    throw new Error("This draft does not match the narrow structured editor shape.");
  }

  const expected = benchmarkCase.expected;
  if (expected !== null && expected !== undefined && typeof expected !== "string") {
    throw new Error("This draft has a non-text expected answer; the structured editor supports text expectations only.");
  }
  return {
    draftId,
    expectedRevision,
    packId: document.pack.packId,
    packName: document.pack.name,
    categoryId: category.categoryId,
    categoryName: category.name,
    benchmarkId: document.benchmark.benchmarkId,
    benchmarkName: document.benchmark.name,
    versionNumber: String(document.benchmarkVersion.versionNumber),
    defaultRepetitions: String(document.benchmarkVersion.defaultRepetitions),
    taskId: task.taskId,
    taskName: task.name,
    taskPrompt: task.prompt,
    taskDifficulty: task.difficulty === undefined ? "" : String(task.difficulty),
    caseId: benchmarkCase.caseId,
    casePrompt: benchmarkCase.prompt ?? "",
    expected: expected ?? "",
    rubricId: rubric.rubricId,
    rubricName: rubric.name,
    criterionId: criterion.criterionId,
    criterionName: criterion.name,
    criterionDescription: criterion.description ?? "",
    criterionWeight: String(criterion.weight),
  };
}
