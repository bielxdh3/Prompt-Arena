import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  normalizeAppearance,
  normalizeFontScale,
  parseAppearancePreferences,
  serializeAppearancePreferences,
} from "./appearance";

describe("appearance preferences", () => {
  it("keeps a stable local default", () => {
    expect(normalizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(normalizeAppearance(undefined)).toEqual(DEFAULT_APPEARANCE);
  });

  it("normalizes every supported preference through bounded choices", () => {
    expect(normalizeAppearance({
      fontId: "arial",
      fontScale: 115,
      accentId: "sage",
      radiusId: "compact",
      surfaceId: "paper",
      reducedMotion: true,
    })).toEqual({
      fontId: "arial",
      fontScale: 115,
      accentId: "sage",
      radiusId: "compact",
      surfaceId: "paper",
      reducedMotion: true,
    });
  });

  it("rejects arbitrary font, accent, surface, and CSS-like values", () => {
    expect(normalizeAppearance({
      fontId: "url(https://example.invalid/font.woff2)",
      fontScale: "200%",
      accentId: "--dangerous-color",
      radiusId: "999px",
      surfaceId: "linear-gradient(red, blue)",
      reducedMotion: "false",
    })).toEqual(DEFAULT_APPEARANCE);
  });

  it("bounds and steps the font scale", () => {
    expect(normalizeFontScale(-10)).toBe(FONT_SCALE_MIN);
    expect(normalizeFontScale(102)).toBe(100);
    expect(normalizeFontScale(113)).toBe(115);
    expect(normalizeFontScale(999)).toBe(FONT_SCALE_MAX);
    expect(normalizeFontScale(Number.NaN)).toBe(DEFAULT_APPEARANCE.fontScale);
  });

  it("round-trips only sanitized preferences", () => {
    const serialized = serializeAppearancePreferences({
      fontId: "missing",
      fontScale: 90,
      accentId: "plum",
      radiusId: "rounded",
      surfaceId: "warm",
      reducedMotion: false,
      futureField: "ignored",
    });
    expect(parseAppearancePreferences(serialized)).toEqual({
      ...DEFAULT_APPEARANCE,
      fontScale: 90,
      accentId: "plum",
      surfaceId: "warm",
    });
    expect(parseAppearancePreferences("not-json")).toEqual(DEFAULT_APPEARANCE);
  });
});
