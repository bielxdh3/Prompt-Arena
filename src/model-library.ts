import type { ModelInfo, ProfileRevision } from "./bridge";

export const PROFILE_RUNTIME = "ollama" as const;
export const MAX_PROFILE_ID_BYTES = 128;
export const MAX_PROFILE_MODEL_BYTES = 256;

export type ProfileFormState = {
  profileId: string;
  revision: string;
  model: string;
};

export const EMPTY_PROFILE_FORM: ProfileFormState = {
  profileId: "",
  revision: "1",
  model: "",
};

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function validateIdentifier(value: string): string {
  const identifier = value.trim();
  if (
    !identifier ||
    identifier === "." ||
    identifier === ".." ||
    byteLength(identifier) > MAX_PROFILE_ID_BYTES ||
    !/^[A-Za-z0-9._-]+$/.test(identifier)
  ) {
    throw new Error("Profile ID must use bounded letters, numbers, dots, dashes, or underscores.");
  }
  return identifier;
}

function validateModel(value: string): string {
  const model = value.trim();
  if (!model || byteLength(model) > MAX_PROFILE_MODEL_BYTES || [...model].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  })) {
    throw new Error("Model name must be non-empty and within the local size limit.");
  }
  return model;
}

function validateRevision(value: string): number {
  const revision = Number(value.trim());
  if (!Number.isInteger(revision) || revision < 1 || revision > 4_294_967_295) {
    throw new Error("Profile revision must be a positive whole number.");
  }
  return revision;
}

export function stableProfileRevisionId(profileId: string, revision: number): string {
  const identifier = validateIdentifier(profileId);
  if (!Number.isInteger(revision) || revision < 1 || revision > 4_294_967_295) {
    throw new Error("Profile revision must be a positive whole number.");
  }
  return `${identifier}@${revision}`;
}

export function profileRevisionFromForm(form: ProfileFormState): ProfileRevision {
  const profileId = validateIdentifier(form.profileId);
  const revision = validateRevision(form.revision);
  const model = validateModel(form.model);
  return {
    profileId,
    profileRevisionId: stableProfileRevisionId(profileId, revision),
    revision,
    model,
    runtime: PROFILE_RUNTIME,
    parameters: {},
    systemPrompt: null,
  };
}

export function profileRevisionIdPreview(form: ProfileFormState): string {
  try {
    return stableProfileRevisionId(form.profileId, validateRevision(form.revision));
  } catch {
    return "—";
  }
}

export function profilePreviewCopy(): string {
  return "Browser preview shows only unsaved profile fields. It does not list or register profile revisions.";
}

export function modelPreviewCopy(): string {
  return "Browser preview does not query Ollama or invent installed model records.";
}

export function profileEmptyCopy(): string {
  return "No immutable local profile revisions are registered yet. Registration uses the fixed Ollama runtime boundary.";
}

export function modelEmptyCopy(): string {
  return "Ollama is reachable but reports no installed models. No catalog, download, or sample model data is shown.";
}

export function modelMetadataLabel(model: ModelInfo): string {
  const facts = [model.family, model.parameterSize, model.quantizationLevel].filter(Boolean);
  return facts.length > 0 ? facts.join(" · ") : "Metadata not reported";
}
