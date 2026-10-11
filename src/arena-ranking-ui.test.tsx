import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { ArenaRankingPanel } from "./App";
import { setActiveLocale, translateText } from "./i18n";
import type { ArenaRankingEntry } from "./arena-runner";

const human: ArenaRankingEntry = {
  rank: 1,
  competitorId: "private-profile-id",
  competitorLabel: "Private Model Alpha",
  metric: "human_average_score",
  value: 4.5,
  sampleSize: 3,
  uncertainty: 0,
  tieMargin: 0,
};

afterEach(() => setActiveLocale("en"));

describe("Arena ranking disclosure and metric labels", () => {
  it("shows human scores only when the completed human ranking is revealed", () => {
    setActiveLocale("en");
    const html = renderToStaticMarkup(<ArenaRankingPanel ranking={[human]} locked revealed />);
    expect(html).toContain("Human scores after immutable lock");
    expect(html).toContain("Private Model Alpha");
    expect(html).toContain("4.50/5 average");
    expect(html).not.toContain("Objective pass rates (human review incomplete)");
  });

  it("labels fully evidenced objective fallback rather than claiming human scores", () => {
    setActiveLocale("en");
    const html = renderToStaticMarkup(
      <ArenaRankingPanel ranking={[{ ...human, metric: "objective_pass_rate", value: 0.75 }]} locked revealed />,
    );
    expect(html).toContain("Objective pass rates (human review incomplete)");
    expect(html).toContain("75% objective pass rate");
    expect(html).not.toContain("Human scores after immutable lock");
  });

  it("provides a screen-reader-visible empty state only after immutable lock and reveal", () => {
    setActiveLocale("en");
    const html = renderToStaticMarkup(<ArenaRankingPanel ranking={[]} locked revealed />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("No comparable ranking available");
    expect(html).toContain("verified objective outcomes for every competitor");
    expect(html).not.toContain("Private Model Alpha");
  });

  it("never leaks identities or ranking availability before reveal, including a locked state", () => {
    for (const ranking of [[human], []]) {
      expect(renderToStaticMarkup(<ArenaRankingPanel ranking={ranking} locked revealed={false} />)).toBe("");
      expect(renderToStaticMarkup(<ArenaRankingPanel ranking={ranking} locked={false} revealed />)).toBe("");
    }
  });

  it("includes the objective and unavailable-ranking copy in pt-BR", () => {
    expect(translateText("pt-BR", "Objective pass rates (human review incomplete)")).toContain("revisão humana incompleta");
    expect(translateText("pt-BR", "No comparable ranking available")).toContain("classificação comparável");
    expect(translateText("pt-BR", "A ranking needs human scores for every competitor or verified objective outcomes for every competitor."))
      .toContain("resultados objetivos verificados");
  });
});
