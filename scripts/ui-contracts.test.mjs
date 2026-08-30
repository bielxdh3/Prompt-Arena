import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const styles = fs.readFileSync(path.join(repositoryRoot, "src", "styles.css"), "utf8");
const i18nSource = fs.readFileSync(path.join(repositoryRoot, "src", "i18n.ts"), "utf8");
const shippedUiSources = ["App.tsx", "advanced-arena-view.tsx"].map((fileName) => fs.readFileSync(path.join(repositoryRoot, "src", fileName), "utf8"));

describe("static UI style contracts", () => {
  it("keeps wide comparison overflow local and restores row flow on narrow screens", () => {
    expect(styles).toMatch(/\.arena-competitor-results\s*\{[^}]*overflow-x:\s*auto/s);
    expect(styles).toMatch(/\.blind-card-grid\s*\{[^}]*overflow-x:\s*auto/s);
    expect(styles).toMatch(/\.blind-card-grid,\s*\.blind-response-grid\s*\{[^}]*overflow-x:\s*visible/s);
    expect(styles).toMatch(/\.arena-live-table\s*\{[^}]*overflow-x:\s*auto/s);
  });

  it("keeps both reduced-motion selectors explicit", () => {
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain('.app-shell[data-reduced-motion="true"] *');
    expect(styles).toContain('.app-shell[data-reduced-motion="true"] *::before');
  });

  it("keeps Models horizontal on desktop and stacked on narrow screens", () => {
    expect(styles).toMatch(/\.models-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1\.15fr\)[^}]*\}/s);
    expect(styles).toMatch(/@media \(max-width: 900px\) \{[\s\S]*?\.models-layout\s*\{[^}]*grid-template-columns:\s*1fr;[\s\S]*?\.model-row\s*\{[^}]*grid-template-columns:\s*1fr;/s);
  });

  it("covers literal translation calls in shipped UI sources", () => {
    const resourceKeys = new Set([...i18nSource.matchAll(/^(?:\s*)(?:"((?:[^"\\]|\\.)+)"|([A-Za-z][A-Za-z0-9_]*))\s*:/gm)].map((match) => match[1] ?? match[2]));
    const missing = shippedUiSources.flatMap((source) => [...source.matchAll(/translate\(\s*"((?:[^"\\]|\\.)+)"\s*\)/g)].map((match) => JSON.parse(`"${match[1]}"`))).filter((message, index, calls) => !resourceKeys.has(message) && calls.indexOf(message) === index);
    expect(missing).toEqual([]);
  });
});
