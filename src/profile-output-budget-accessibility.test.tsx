import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FormInput, ModelsView } from "./App";

describe("profile output-token accessibility", () => {
  it("connects the profile budget hint and preserves validation descriptions", () => {
    const profileMarkup = renderToStaticMarkup(<ModelsView />);
    const profileInput = profileMarkup.match(/<input\b[^>]*id="profile-max-tokens"[^>]*>/)?.[0];
    expect(profileInput).toContain('aria-describedby="profile-max-tokens-help"');
    expect(profileMarkup).toContain('<p id="profile-max-tokens-help"');

    const invalidFieldMarkup = renderToStaticMarkup(
      <FormInput
        id="profile-max-tokens"
        label="Maximum output tokens"
        value="0"
        onChange={() => undefined}
        descriptionId="profile-max-tokens-help"
        error="Maximum output tokens must be a whole number between 1 and 32,768."
      />,
    );
    expect(invalidFieldMarkup).toContain('aria-describedby="profile-max-tokens-error profile-max-tokens-help"');
  });

  it("connects the profile context-window hint to its input", () => {
    const profileMarkup = renderToStaticMarkup(<ModelsView />);
    const profileInput = profileMarkup.match(/<input\b[^>]*id="profile-context-window-tokens"[^>]*>/)?.[0];
    expect(profileInput).toContain('aria-describedby="profile-context-window-tokens-help"');
    expect(profileMarkup).toContain('<p id="profile-context-window-tokens-help"');
  });
});
