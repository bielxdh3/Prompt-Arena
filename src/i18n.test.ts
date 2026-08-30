import { describe, expect, it } from "vitest";
import {
  APP_LOCALE_STORAGE_KEY,
  formatLocaleCurrency,
  formatLocaleDuration,
  formatLocaleNumber,
  formatLocalePercent,
  loadAppLocale,
  normalizeAppLocale,
  saveAppLocale,
  translateText,
} from "./i18n";
import { arenaTelemetryLabel, type ArenaSampleTelemetry } from "./arena-runner";

function fakeStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("i18n", () => {
  it("accepts only the supported locales and falls back to English", () => {
    expect(normalizeAppLocale("en")).toBe("en");
    expect(normalizeAppLocale("pt-BR")).toBe("pt-BR");
    for (const value of [undefined, null, "pt-br", "fr", 1, {}]) {
      expect(normalizeAppLocale(value)).toBe("en");
    }
  });

  it("loads and saves the locale through storage", () => {
    const storage = fakeStorage();

    expect(loadAppLocale(storage)).toBe("en");
    saveAppLocale("pt-BR", storage);
    expect(storage.getItem(APP_LOCALE_STORAGE_KEY)).toBe("pt-BR");
    expect(loadAppLocale(storage)).toBe("pt-BR");
    saveAppLocale("en", storage);
    expect(loadAppLocale(storage)).toBe("en");
  });

  it("translates known PT-BR messages and preserves English or unknown text", () => {
    expect(translateText("en", "Settings")).toBe("Settings");
    expect(translateText("pt-BR", "Settings")).toBe("Configurações");
    expect(translateText("pt-BR", "Run Arena")).toBe("Executar Arena");
    expect(translateText("pt-BR", "Not in the catalog")).toBe("Not in the catalog");
  });

  it("keeps critical P2 controls translated without exposing internal labels", () => {
    expect(translateText("pt-BR", "Advanced local controls")).toBe("Controles locais avançados");
    expect(translateText("pt-BR", "Advanced diagnostics")).toBe("Diagnóstico avançado");
    expect(translateText("pt-BR", "Local measurement")).toBe("Medição local");
    expect(translateText("pt-BR", "Windows system API")).toBe("API do sistema Windows");
    expect(translateText("en", "Advanced local controls")).toBe("Advanced local controls");
  });

  it("formats numbers, percentages, currencies, and durations per locale", () => {
    expect(formatLocaleNumber(1234.56, "en")).toBe("1,234.56");
    expect(formatLocaleNumber(1234.56, "pt-BR")).toBe("1.234,56");
    expect(formatLocalePercent(0.123, "en")).toBe("12.3%");
    expect(formatLocalePercent(0.123, "pt-BR")).toBe("12,3%");
    expect(formatLocaleCurrency(12.34, "en", "USD")).toContain("$12.34");
    expect(formatLocaleCurrency(12.34, "pt-BR", "USD")).toContain("12,34");
    expect(formatLocaleDuration(1250, "en")).toBe("1.3 s");
    expect(formatLocaleDuration(1250, "pt-BR")).toBe("1,3 s");
    expect(formatLocaleDuration(61000, "en")).toBe("1m 1s");
    expect(formatLocaleDuration(-1, "pt-BR")).toBe("Indisponível");
  });

  it("labels telemetry samples in English and PT-BR without React", () => {
    const sample: ArenaSampleTelemetry = {
      competitorId: "profile@1",
      competitorLabel: "Local model",
      competitorOrdinal: 1,
      repetition: 1,
      sampleIndex: 0,
      status: "queued",
      startedAtMs: null,
      elapsedMs: 0,
      durationMs: null,
      metrics: {
        loadDurationMs: null,
        ttftMs: null,
        generationDurationMs: null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        tokensPerSecond: null,
        authoritative: false,
      },
      error: null,
    };

    expect(arenaTelemetryLabel(sample, true, "en")).toBe("Competitor B");
    expect(arenaTelemetryLabel(sample, true, "pt-BR")).toBe("Competidor B");
    expect(arenaTelemetryLabel(sample, false, "pt-BR")).toBe("Local model");
  });
});
