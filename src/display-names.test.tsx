import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { displayName, numberedName, profileDisplayName } from "./display-names";
import { formatLocaleDate, formatMessage, setActiveLocale } from "./i18n";
import { attemptStatusLabel, attemptStatusTone, formatCount } from "./results-ui";
import { FormFeedback, HumanError } from "./human-error";
import { formatByokDecision, formatIdentityConfidence } from "./byok-ui";
import { formatAdvancedValue } from "./advanced-arena-ui";

afterEach(() => setActiveLocale("en"));

describe("human display identity", () => {
  it("keeps UUIDs and generated keys out of primary names in both languages", () => {
    for (const locale of ["en", "pt-BR"] as const) {
      setActiveLocale(locale);
      for (const id of ["arena-f750c9c0-c39f-45e2-b8e6-5562efa53cbe-1-1", "profile-1@2", "a".repeat(64), ""]) {
        const label = displayName(id, "Run", 12);
        expect(label).toBe(locale === "en" ? "Run 12" : "Execução 12");
      }
      expect(displayName("Qwen 3.5 9B", "Model")).toBe("Qwen 3.5 9B");
    }
  });
  it("keeps numbering stable when a list is reordered and distinguishes configurations", () => {
    expect(numberedName("Run", "b", ["a", "b"])).toBe(numberedName("Run", "b", ["b", "a"]));
    expect(profileDisplayName({ model: "Qwen", revision: 2, runtime: "ollama" })).toContain("Configuration 2");
  });
  it("localizes result helpers without changing status colors", () => {
    setActiveLocale("pt-BR");
    expect(attemptStatusLabel("completed")).toBe("Concluída");
    expect(attemptStatusTone("completed")).toBe("success");
    expect(attemptStatusTone("failed")).toBe("failure");
    expect(formatCount(1234)).toBe("1.234");
    expect(formatMessage("{completed}/{total} samples completed", { completed: 1200, total: 1400 })).toBe("1.200/1.400 amostras concluídas");
    expect(attemptStatusLabel("internal_state_v9")).toBe("Desconhecido");
    expect(formatLocaleDate("1789353240")).toBe(formatLocaleDate(1789353240000));
    expect(formatLocaleDate("invalid timestamp")).toBe("Não registrado");
  });
  it("renders raw errors only inside collapsed technical details", () => {
    setActiveLocale("pt-BR");
    const html = renderToStaticMarkup(<HumanError summary="Run history unavailable" detail="ECONNREFUSED raw runtime failure" />);
    expect(html).toContain("Detalhes técnicos");
    expect(html).toMatch(/<details><summary>.*<\/summary><pre[^>]*>ECONNREFUSED/);
    expect(html).not.toContain("<details open");
  });
  it("localizes action feedback and provider result values", () => {
    setActiveLocale("pt-BR");
    expect(formatByokDecision("allow")).toBe("Permitido");
    expect(formatIdentityConfidence("unverified")).toBe("Não verificado");
    expect(formatAdvancedValue(1.25)).toBe("1,25");
    const html = renderToStaticMarkup(<FormFeedback kind="error" message="ECONNREFUSED private-runtime-code" />);
    expect(html).toContain("Não foi possível concluir a ação.");
    expect(html.split("<details>")[0]).not.toContain("ECONNREFUSED");
    expect(html).toContain("ECONNREFUSED private-runtime-code");
    expect(html).not.toContain("<details open");
  });
});
