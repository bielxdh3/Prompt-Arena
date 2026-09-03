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

  it("translates the overview local-model metric label", () => {
    expect(translateText("pt-BR", "Local models")).toBe("Modelos locais");
  });

  it("covers AST-audited PT-BR fallback literals", () => {
    const messages = {
      "Reading runs, Arena summaries, profile revisions, and local model inventory.": "Lendo execuções, resumos da Arena, revisões de perfis e inventário de modelos locais.",
      "The browser preview does not read desktop records or invent counts. Open the desktop app to see local workspace data.": "A prévia do navegador não lê registros do desktop nem inventa contagens. Abra o aplicativo desktop para ver os dados do espaço de trabalho local.",
      "Workspace data unavailable": "Dados do espaço de trabalho indisponíveis",
      "Complete an Arena in the desktop app to see its aggregate evidence here. No sample records are bundled.": "Conclua uma Arena no aplicativo desktop para ver suas evidências agregadas aqui. Nenhum registro de amostra é incluído.",
      "Benchmark records unavailable": "Registros de benchmark indisponíveis",
      "Loading official catalog": "Carregando catálogo oficial",
      "Validating bundled benchmark-v1 documents at the desktop boundary.": "Validando os documentos benchmark-v1 empacotados no limite do desktop.",
      "Official catalog unavailable": "Catálogo oficial indisponível",
      "Inspect a bundled pack": "Inspecione um pacote empacotado",
      "Choose an official pack to read its metadata and canonical document.": "Escolha um pacote oficial para ler seus metadados e o documento canônico.",
      "Loading pack document": "Carregando documento do pacote",
      "Reading the validated bundled source record.": "Lendo o registro de origem empacotado e validado.",
      "Pack document unavailable": "Documento do pacote indisponível",
      Version: "Versão",
      "Canonical bytes": "Bytes canônicos",
      Capability: "Capacidade",
      Sandbox: "Sandbox",
      Evaluation: "Avaliação",
      "This pack requires Docker, which is unavailable in this build. Host execution is never used.": "Este pacote requer Docker, que está indisponível nesta compilação. A execução no host nunca é usada.",
      "Pack execution unavailable": "Execução do pacote indisponível",
      "The declared execution boundary is unavailable; no fallback runtime is used.": "O limite de execução declarado está indisponível; nenhum runtime alternativo é usado.",
      "Materializing official pack": "Materializando pacote oficial",
      "Deriving deterministic case seeds and writing one immutable local evidence record.": "Derivando sementes determinísticas de casos e gravando um registro local de evidência imutável.",
      "Materialization unavailable": "Materialização indisponível",
      "Materialization ID": "ID da materialização",
      "Materialized content hash": "Hash do conteúdo materializado",
      "Seeded cases": "Casos semeados",
      "Filter catalog": "Filtrar catálogo",
      "Relative path under the managed model root": "Caminho relativo sob a raiz de modelos gerenciados",
      "Checking local sources": "Verificando fontes locais",
      "Local model catalog unavailable": "Catálogo de modelos locais indisponível",
      "Profile ID": "ID do perfil",
      Revision: "Revisão",
      "Loading profiles": "Carregando perfis",
      "Reading immutable profile revisions from SQLite.": "Lendo revisões imutáveis de perfis do SQLite.",
      "Profiles unavailable": "Perfis indisponíveis",
      "Reading hardware baseline": "Lendo a linha de base do hardware",
      "Hardware baseline unavailable": "Linha de base do hardware indisponível",
      "Benchmark version": "Versão do benchmark",
      Uncertainty: "Incerteza",
      "Tie margin": "Margem de empate",
      "Benchmark version identity": "Identidade da versão do benchmark",
      "Terminal status": "Status terminal",
      "Profile/runtime/model": "Perfil/runtime/modelo",
      "Completed attempts": "Tentativas concluídas",
      "Objective exact-text evidence": "Evidência de texto exato do objetivo",
      "SHA-256": "SHA-256",
      "Response preview is bounded at": "A prévia da resposta é limitada a",
      "characters. The verified byte count and hash cover the complete artifact.": "caracteres. A contagem de bytes e o hash verificados abrangem o artefato completo.",
    };

    for (const [message, translation] of Object.entries(messages)) {
      expect(translateText("pt-BR", message)).toBe(translation);
    }
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
