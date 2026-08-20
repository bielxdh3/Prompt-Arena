import { describe, expect, it } from "vitest";
import { DEFAULT_FONT_ID, FONT_OPTIONS, getFontOption } from "./font-options";

describe("font options", () => {
  it("keeps the requested default and a usable selection", () => {
    expect(FONT_OPTIONS.length).toBeGreaterThanOrEqual(6);
    expect(DEFAULT_FONT_ID).toBe("times");
    expect(getFontOption("missing").id).toBe(DEFAULT_FONT_ID);
    expect(new Set(FONT_OPTIONS.map((option) => option.id)).size).toBe(FONT_OPTIONS.length);
  });
});
