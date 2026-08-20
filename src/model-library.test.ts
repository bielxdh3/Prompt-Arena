import { describe, expect, it } from "vitest";
import {
  EMPTY_PROFILE_FORM,
  modelEmptyCopy,
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
    expect(revision.extra).toEqual({});
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
    expect(modelEmptyCopy()).toContain("No catalog, download, or sample");
  });
});
