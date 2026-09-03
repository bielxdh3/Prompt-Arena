import { describe, expect, it } from "vitest";
import {
  DEFAULT_APPEARANCE,
  APPEARANCE_PAYLOAD_VERSION,
  FONT_SCALE_MAX,
  FONT_SCALE_MIN,
  MAX_APPEARANCE_PAYLOAD_BYTES,
  MOTION_SCALE_DEFAULT,
  MOTION_SCALE_MAX,
  MOTION_SCALE_MIN,
  importAppearancePreferences,
  normalizeAppearance,
  normalizeFontScale,
  normalizeMotionScale,
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
      contrastId: "high",
      reducedMotion: true,
      motionScale: 125,
    })).toEqual({
      fontId: "arial",
      fontScale: 115,
      accentId: "sage",
      radiusId: "compact",
      surfaceId: "paper",
      contrastId: "high",
      reducedMotion: true,
      motionScale: 125,
    });
  });

  it("rejects arbitrary font, accent, surface, and CSS-like values", () => {
    expect(normalizeAppearance({
      fontId: "url(https://example.invalid/font.woff2)",
      fontScale: "200%",
      accentId: "--dangerous-color",
      radiusId: "999px",
      surfaceId: "linear-gradient(red, blue)",
      contrastId: "--low-contrast",
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

  it("bounds the motion scale from zero to two hundred percent", () => {
    expect(DEFAULT_APPEARANCE.motionScale).toBe(MOTION_SCALE_DEFAULT);
    expect(normalizeMotionScale(-1)).toBe(MOTION_SCALE_MIN);
    expect(normalizeMotionScale(100)).toBe(MOTION_SCALE_DEFAULT);
    expect(normalizeMotionScale(100.6)).toBe(101);
    expect(normalizeMotionScale(999)).toBe(MOTION_SCALE_MAX);
    expect(normalizeMotionScale(Number.NaN)).toBe(MOTION_SCALE_DEFAULT);
  });

  it("round-trips only sanitized preferences", () => {
    const serialized = serializeAppearancePreferences({
      fontId: "missing",
      fontScale: 90,
      accentId: "plum",
      radiusId: "rounded",
      surfaceId: "warm",
      contrastId: "high",
      reducedMotion: false,
      motionScale: 80,
      futureField: "ignored",
    });
    expect(parseAppearancePreferences(serialized)).toEqual({
      ...DEFAULT_APPEARANCE,
      fontScale: 90,
      accentId: "plum",
      surfaceId: "warm",
      contrastId: "high",
      motionScale: 80,
    });
    expect(parseAppearancePreferences("not-json")).toEqual(DEFAULT_APPEARANCE);
  });

  it("exports a bounded versioned payload and normalizes imports", () => {
    const serialized = serializeAppearancePreferences({
      fontId: "arial",
      fontScale: 102,
      accentId: "sage",
      radiusId: "compact",
      surfaceId: "paper",
      contrastId: "high",
      reducedMotion: true,
      motionScale: 175,
      apiKey: "must-not-export",
      headers: { Authorization: "must-not-export" },
    });
    const payload = JSON.parse(serialized) as Record<string, unknown>;
    expect(payload).toEqual({
      schemaVersion: APPEARANCE_PAYLOAD_VERSION,
      preferences: {
        fontId: "arial",
        fontScale: 100,
        accentId: "sage",
        radiusId: "compact",
        surfaceId: "paper",
        contrastId: "high",
        reducedMotion: true,
        motionScale: 175,
      },
    });
    expect(serialized.length).toBeLessThan(MAX_APPEARANCE_PAYLOAD_BYTES);
    expect(importAppearancePreferences(serialized)).toEqual(payload.preferences);
  });

  it("rejects oversized or unversioned preference imports without changing defaults", () => {
    expect(() => importAppearancePreferences("x".repeat(MAX_APPEARANCE_PAYLOAD_BYTES + 1))).toThrow("8 KiB");
    expect(() => importAppearancePreferences(JSON.stringify({ fontId: "arial" }))).toThrow("unsupported format");
    expect(parseAppearancePreferences(JSON.stringify({ schemaVersion: 99, preferences: { fontId: "arial" } })))
      .toEqual(DEFAULT_APPEARANCE);
  });
});
