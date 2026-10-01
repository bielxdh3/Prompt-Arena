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

  it("translates the Docker text-verifier state and evidence labels", () => {
    expect(translateText("pt-BR", "Docker-backed text verification required")).toBe("Verificação de texto via Docker obrigatória");
    expect(translateText("pt-BR", "Verifier unavailable")).toBe("Verificação indisponível");
    expect(translateText("pt-BR", "Docker verifier status")).toBe("Status do verificador Docker");
    expect(translateText("pt-BR", "Verifier cancelled")).toBe("Verificação cancelada");
    expect(translateText("pt-BR", "Cancel Arena")).toBe("Cancelar Arena");
  });

  it("translates the overview local-model metric label", () => {
    expect(translateText("pt-BR", "Local models")).toBe("Modelos locais");
  });

  it("translates robustness history comparison and export notices", () => {
    expect(translateText("pt-BR", "Robustness history comparison")).toBe("Comparação histórica de robustez");
    expect(translateText("pt-BR", "Compare robustness results")).toBe("Comparar resultados de robustez");
    expect(translateText("pt-BR", "Robustness comparison exports include prompt variants and saved results. Review the file before sharing."))
      .toBe("As exportações de comparação de robustez incluem variantes de prompt e resultados salvos. Revise o arquivo antes de compartilhar.");
  });

  it("translates feature navigation and the discovered-model selector", () => {
    expect(translateText("pt-BR", "Insights")).toBe("Análises");
    expect(translateText("pt-BR", "Benchmarks")).toBe("Testes de referência");
    expect(translateText("pt-BR", "Discovered local model (optional)")).toBe("Modelo local descoberto (opcional)");
    expect(translateText("pt-BR", "Browser preview shows only unsaved profile fields. It does not list or register profile revisions.")).toBe("A pré-visualização do navegador mostra apenas campos de perfil não salvos. Ela não lista nem registra revisões de perfil.");
    expect(translateText("pt-BR", "Host CPU usage")).toBe("Uso da CPU do host");
    expect(translateText("pt-BR", "Average host RAM")).toBe("Uso médio da RAM do host");
    expect(translateText("pt-BR", "Peak host RAM")).toBe("Pico de RAM usada no host");
    expect(translateText("pt-BR", "Host CPU and RAM cover the whole system during generation; they are not attributed to the model process.")).toBe("CPU e RAM do host abrangem o sistema inteiro durante a geração; os valores não são atribuídos ao processo do modelo.");
    expect(translateText("pt-BR", "Scope")).toBe("Escopo");
    expect(translateText("pt-BR", "Whole host")).toBe("Sistema inteiro");
    expect(translateText("pt-BR", "Operating system snapshot")).toBe("Leitura pontual do sistema operacional");
    expect(translateText("pt-BR", "Runtime-reported")).toBe("Informado pelo runtime");
    expect(translateText("pt-BR", "Derived metric")).toBe("Métrica derivada");
    expect(translateText("pt-BR", "Aggregation method")).toBe("Método de agregação");
    expect(translateText("pt-BR", "Average sampling interval")).toBe("Intervalo médio de amostragem");
    expect(translateText("pt-BR", "Sample count")).toBe("Quantidade de amostras");
    expect(translateText("pt-BR", "Interval count")).toBe("Quantidade de intervalos");
    expect(translateText("pt-BR", "Raw samples truncated")).toBe("Série de amostras brutas truncada");
    expect(translateText("pt-BR", "Repro bundle generated. Review the prompt, saved response, profile, and host CPU/RAM evidence before sharing.")).toBe("Pacote de reprodução gerado. Revise o prompt, a resposta salva, o perfil e as evidências de CPU/RAM do host antes de compartilhar.");
    expect(translateText("pt-BR", "Bundle file is ready, but its local history record could not be saved. Review the prompt, saved response, profile, and host CPU/RAM evidence before sharing.")).toBe("O arquivo do pacote está pronto, mas não foi possível salvar seu registro no histórico local. Revise o prompt, a resposta salva, o perfil e as evidências de CPU/RAM do host antes de compartilhá-lo.");
    expect(translateText("pt-BR", "Credential fields are filtered, but the bundle can contain profile prompts, saved response text, and host CPU/RAM evidence. Review the complete bundle before sharing; response text and prompts may contain private information, and the checksum does not identify the creator.")).toBe("Campos de credenciais são filtrados, mas o pacote pode conter prompts do perfil, texto da resposta salva e evidências de CPU/RAM do host. Revise o pacote completo antes de compartilhá-lo; respostas e prompts podem conter informações privadas, e o checksum não identifica quem o criou.");
    expect(translateText("pt-BR", "The saved response output is inconsistent or exceeds the local size limit.")).toBe("A resposta salva é inconsistente ou excede o limite de tamanho local.");
    expect(translateText("pt-BR", "Register immutable local profile revisions and discover Ollama, LM Studio, and llama.cpp through explicit loopback endpoints. Import only app-managed relative GGUF paths and keep operation and removal evidence locally. Model inventory is not sent to a cloud provider. The hardware baseline is read-only; local generation can record host CPU/RAM with attempt evidence.")).toBe("Registre revisões imutáveis de perfis locais e descubra Ollama, LM Studio e llama.cpp por endpoints de loopback explícitos. Importe apenas caminhos GGUF relativos gerenciados pelo aplicativo e mantenha localmente as evidências de operação e remoção. O inventário de modelos não é enviado a provedores em nuvem. A linha de base de hardware é somente leitura; a geração local pode registrar CPU/RAM do host na evidência da tentativa.");
  });

  it("translates the profile output-token control", () => {
    expect(translateText("pt-BR", "Maximum output tokens")).toBe("Máximo de tokens de saída");
    expect(translateText("pt-BR", "Optional. Leave blank to preserve the runtime default. A set value caps generated output; change the revision to save a different budget.")).toBe("Opcional. Deixe em branco para preservar o padrão do runtime. Um valor definido limita a saída gerada; altere a revisão para salvar outro limite.");
  });

  it("translates the profile context-window control", () => {
    expect(translateText("pt-BR", "Context window size (tokens)")).toBe("Tamanho da janela de contexto (tokens)");
    expect(translateText("pt-BR", "Optional. Leave blank to preserve the runtime default. Ollama supports this override; other runtimes reject it.")).toBe("Opcional. Deixe em branco para preservar o padrão do runtime. O Ollama aceita essa substituição; outros runtimes a rejeitam.");
    expect(translateText("pt-BR", "Context window size must be a positive 32-bit whole number.")).toBe("O tamanho da janela de contexto deve ser um número inteiro positivo de 32 bits.");
  });

  it("translates the unsupported Repro Bundle seed warning", () => {
    expect(translateText("pt-BR", "This bundle uses a seed control that the local single-model runner cannot apply; rerunning is disabled.")).toBe("Este pacote usa um controle de semente que o executor local de modelo único não consegue aplicar; a nova execução está desativada.");
    expect(translateText("pt-BR", "The imported benchmark and saved profile match local records, but this runtime does not provide the live model identity check required for Re-run. Re-running is disabled.")).toBe("O benchmark importado e o perfil salvo correspondem aos registros locais, mas este runtime não fornece a verificação ativa de identidade do modelo exigida para a reexecução. A reexecução está desativada.");
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

    const englishLabel = arenaTelemetryLabel(sample, true, "en");
    expect(englishLabel).toBe("Competitor");
    expect(arenaTelemetryLabel({ ...sample, competitorOrdinal: 0 }, true, "en")).toBe(englishLabel);
    expect(arenaTelemetryLabel(sample, true, "pt-BR")).toBe("Competidor");
    expect(arenaTelemetryLabel(sample, false, "pt-BR")).toBe("Local model");
    expect(translateText("pt-BR", "Execution failed; details withheld.")).toBe("Falha na execução; detalhes ocultos.");
  });
});

