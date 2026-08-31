import { DEFAULT_FONT_ID, getFontOption } from "./font-options";

export const APPEARANCE_STORAGE_KEY = "prompt-arena.appearance.v1";
export const APPEARANCE_PAYLOAD_VERSION = 1;
export const MAX_APPEARANCE_PAYLOAD_BYTES = 8 * 1024;
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

export const CONTRAST_OPTIONS = [
  { id: "standard", label: "Default", description: "Balanced text and surface contrast" },
  { id: "high", label: "High contrast", description: "Stronger reading and focus contrast" },
] as const;

export type AccentId = (typeof ACCENT_OPTIONS)[number]["id"];
export type RadiusId = (typeof RADIUS_OPTIONS)[number]["id"];
export type SurfaceId = (typeof SURFACE_OPTIONS)[number]["id"];
export type ContrastId = (typeof CONTRAST_OPTIONS)[number]["id"];

export type AppearancePreferences = {
  fontId: string;
  fontScale: number;
  accentId: AccentId;
  radiusId: RadiusId;
  surfaceId: SurfaceId;
  contrastId: ContrastId;
  reducedMotion: boolean;
};

export type AppearancePreferencePayload = {
  schemaVersion: typeof APPEARANCE_PAYLOAD_VERSION;
  preferences: AppearancePreferences;
};

export const DEFAULT_APPEARANCE: AppearancePreferences = {
  fontId: DEFAULT_FONT_ID,
  fontScale: 100,
  accentId: "sand",
  radiusId: "rounded",
  surfaceId: "neutral",
  contrastId: "standard",
  reducedMotion: false,
};

function optionId<T extends { id: string }>(options: readonly T[], value: unknown, fallback: T["id"]): T["id"] {
  return options.find((option) => option.id === value)?.id ?? fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function normalizeFontScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_APPEARANCE.fontScale;
  const stepped = Math.round(value / FONT_SCALE_STEP) * FONT_SCALE_STEP;
  return Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, stepped));
}

export function normalizeAppearance(input: unknown): AppearancePreferences {
  const source = isRecord(input) ? input : {};
  return {
    fontId: typeof source.fontId === "string" ? getFontOption(source.fontId).id : DEFAULT_APPEARANCE.fontId,
    fontScale: normalizeFontScale(source.fontScale),
    accentId: optionId(ACCENT_OPTIONS, source.accentId, DEFAULT_APPEARANCE.accentId),
    radiusId: optionId(RADIUS_OPTIONS, source.radiusId, DEFAULT_APPEARANCE.radiusId),
    surfaceId: optionId(SURFACE_OPTIONS, source.surfaceId, DEFAULT_APPEARANCE.surfaceId),
    contrastId: optionId(CONTRAST_OPTIONS, source.contrastId, DEFAULT_APPEARANCE.contrastId),
    reducedMotion: typeof source.reducedMotion === "boolean" ? source.reducedMotion : DEFAULT_APPEARANCE.reducedMotion,
  };
}

export function parseAppearancePreferences(serialized: string | null): AppearancePreferences {
  if (!serialized) return normalizeAppearance(null);
  if (utf8ByteLength(serialized) > MAX_APPEARANCE_PAYLOAD_BYTES) return normalizeAppearance(null);
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (isRecord(parsed) && parsed.schemaVersion !== undefined) {
      return parsed.schemaVersion === APPEARANCE_PAYLOAD_VERSION
        ? normalizeAppearance(parsed.preferences)
        : normalizeAppearance(null);
    }
    return normalizeAppearance(parsed);
  } catch {
    return normalizeAppearance(null);
  }
}

export function serializeAppearancePreferences(input: unknown): string {
  const payload: AppearancePreferencePayload = {
    schemaVersion: APPEARANCE_PAYLOAD_VERSION,
    preferences: normalizeAppearance(input),
  };
  const serialized = JSON.stringify(payload);
  if (utf8ByteLength(serialized) > MAX_APPEARANCE_PAYLOAD_BYTES) {
    throw new Error("Appearance preferences exceed the local 8 KiB limit.");
  }
  return serialized;
}

export function importAppearancePreferences(serialized: string): AppearancePreferences {
  if (utf8ByteLength(serialized) > MAX_APPEARANCE_PAYLOAD_BYTES) {
    throw new Error("Appearance preference files must be 8 KiB or smaller.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Appearance preference file is not valid JSON.");
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== APPEARANCE_PAYLOAD_VERSION || !isRecord(parsed.preferences)) {
    throw new Error("Appearance preference file has an unsupported format.");
  }
  return normalizeAppearance(parsed.preferences);
}
