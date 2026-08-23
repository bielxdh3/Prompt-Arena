import { DEFAULT_FONT_ID, getFontOption } from "./font-options";

export const APPEARANCE_STORAGE_KEY = "prompt-arena.appearance.v1";
export const FONT_SCALE_MIN = 90;
export const FONT_SCALE_MAX = 115;
export const FONT_SCALE_STEP = 5;

export const ACCENT_OPTIONS = [
  { id: "sand", label: "Sand" },
  { id: "sage", label: "Sage" },
  { id: "plum", label: "Plum" },
] as const;

export const RADIUS_OPTIONS = [
  { id: "compact", label: "Compact", description: "Tighter corners and denser surfaces" },
  { id: "rounded", label: "Rounded", description: "The default spacious corner scale" },
] as const;

export const SURFACE_OPTIONS = [
  { id: "neutral", label: "Dark neutral", description: "Quiet charcoal surfaces" },
  { id: "warm", label: "Dark warm", description: "A softer brown-black canvas" },
  { id: "paper", label: "Paper", description: "A light, high-contrast reading surface" },
] as const;

export type AccentId = (typeof ACCENT_OPTIONS)[number]["id"];
export type RadiusId = (typeof RADIUS_OPTIONS)[number]["id"];
export type SurfaceId = (typeof SURFACE_OPTIONS)[number]["id"];

export type AppearancePreferences = {
  fontId: string;
  fontScale: number;
  accentId: AccentId;
  radiusId: RadiusId;
  surfaceId: SurfaceId;
  reducedMotion: boolean;
};

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  fontId: DEFAULT_FONT_ID,
  fontScale: 100,
  accentId: "sand",
  radiusId: "rounded",
  surfaceId: "neutral",
  reducedMotion: false,
};

function optionId<T extends { id: string }>(options: readonly T[], value: unknown, fallback: T["id"]): T["id"] {
  return options.find((option) => option.id === value)?.id ?? fallback;
}

export function normalizeFontScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_APPEARANCE.fontScale;
  const stepped = Math.round(value / FONT_SCALE_STEP) * FONT_SCALE_STEP;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, stepped));
}

export function normalizeAppearance(input: unknown): AppearancePreferences {
  const source = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  return {
    fontId: typeof source.fontId === "string" ? getFontOption(source.fontId).id : DEFAULT_APPEARANCE.fontId,
    fontScale: normalizeFontScale(source.fontScale),
    accentId: optionId(ACCENT_OPTIONS, source.accentId, DEFAULT_APPEARANCE.accentId),
    radiusId: optionId(RADIUS_OPTIONS, source.radiusId, DEFAULT_APPEARANCE.radiusId),
    surfaceId: optionId(SURFACE_OPTIONS, source.surfaceId, DEFAULT_APPEARANCE.surfaceId),
    reducedMotion: typeof source.reducedMotion === "boolean" ? source.reducedMotion : DEFAULT_APPEARANCE.reducedMotion,
  };
}

export function parseAppearancePreferences(serialized: string | null): AppearancePreferences {
  if (!serialized) return normalizeAppearance(null);
  try {
    return normalizeAppearance(JSON.parse(serialized));
  } catch {
    return normalizeAppearance(null);
  }
}

export function serializeAppearancePreferences(input: unknown): string {
  return JSON.stringify(normalizeAppearance(input));
}
