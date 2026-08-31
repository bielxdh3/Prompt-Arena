import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const styles = fs.readFileSync(path.join(repositoryRoot, "src", "styles.css"), "utf8");
const i18nSource = fs.readFileSync(path.join(repositoryRoot, "src", "i18n.ts"), "utf8");
const appSource = fs.readFileSync(path.join(repositoryRoot, "src", "App.tsx"), "utf8");
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

  it("keeps new translated listbox props backed by the PT-BR resource", () => {
    for (const message of ["Select repetitions", "Choose a score", "Choose a response"]) {
      expect(i18nSource).toMatch(new RegExp(`(?:\\"${message}\\")\\s*:`));
    }
  });

  it("keeps the exact PT-BR case-prompt fallback", () => {
    expect(i18nSource).toMatch(/"No case-specific prompt"\s*:\s*"Sem prompt específico para este caso"/);
  });

  it("keeps centralized polish contracts for motion, themes, scrollbars, and Models spacing", () => {
    for (const token of ["--motion-page", "--motion-reveal", "--motion-expand", "--motion-stagger", "--space-section"]) {
      expect(styles).toContain(token);
    }
    expect(styles).toMatch(/\.page-transition\s*\{[^}]*animation:\s*page-enter\s+var\(--motion-page\)/s);
    expect(styles).toMatch(/\.scroll-reveal\s*\{[^}]*transition:[^}]*var\(--motion-reveal\)/s);
    expect(appSource).toContain("observer.unobserve(entry.target)");
    expect(styles).toMatch(/details\.motion-disclosure\[open\][\s\S]*animation-delay:\s*var\(--motion-stagger\)/);
    expect(styles).toMatch(/@keyframes orbit-(?:rotate|one-rotate|two-rotate)/);
    expect(styles).toMatch(/\.orbit-one\s*\{[^}]*animation-duration:/s);
    expect(styles).toMatch(/\.hero-orbit \.orbit\s*\{\s*animation:\s*none !important;/s);
    expect(styles).toMatch(/\.app-shell\[data-reduced-motion="true"\][\s\S]*transition-duration:\s*0\.01ms/s);

    const paperBlock = styles.match(/\.app-shell\[data-surface="paper"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(paperBlock).toMatch(/--color-canvas:\s*#dcd5c8/);
    expect(paperBlock).toMatch(/--color-surface:\s*#e8e1d5/);
    expect(paperBlock).not.toMatch(/#fff/i);
    expect(styles).toMatch(/\.workspace,[\s\S]*\.advanced-textarea\s*\{[^}]*scrollbar-color:/s);
    expect(styles).toMatch(/\.app-shell\[data-contrast="high"\]\s*\{[^}]*--scrollbar-thumb:/s);
    expect(styles).toMatch(/\.app-shell\[data-contrast="high"\]\[data-surface="paper"\]/);
    expect(styles).toMatch(/\.model-list-panel > \.profile-records,[\s\S]*\.profile-panel > \.profile-records\s*\{[^}]*margin-top:\s*var\(--space-section\)/s);
  });
});
