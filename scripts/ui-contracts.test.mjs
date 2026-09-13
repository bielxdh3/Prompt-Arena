import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
const styles = read("src/styles.css");
const listboxSource = read("src/accessible-listbox.tsx");
const i18nSource = read("src/i18n.ts");
const appSource = read("src/App.tsx");

describe("static UI parity contracts", () => {
  it("keeps the shared motion system and reduced-motion precedence explicit", () => {
    for (const token of ["--motion-page", "--motion-reveal", "--motion-expand", "--motion-stagger", "--space-section"]) {
      expect(styles).toContain(token);
    }
    expect(styles).toContain("--motion-page: calc(var(--motion-page-base) * var(--motion-scale-effective))");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).toContain('.app-shell[data-reduced-motion="true"] *');
    expect(styles).toContain('.app-shell[data-reduced-motion="true"] *::before');
    expect(styles).toContain("--motion-scale-effective: 0");
    expect(styles).toContain("@keyframes orbit-ring-outer");
    expect(styles).toContain("@keyframes orbit-ring-middle");
    expect(styles).toContain(".hero-orbit .orbit");
  });

  it("keeps Paper and high-contrast tokens readable", () => {
    const paperBlock = styles.match(/\.app-shell\[data-surface="paper"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(paperBlock).toContain("--color-canvas: #c8bfb0");
    expect(paperBlock).toContain("--color-surface: #d7cdbd");
    expect(paperBlock).toContain("--color-focus: #51370e");
    expect(styles).toContain('.app-shell[data-contrast="high"]');
    expect(styles).toContain('.app-shell[data-contrast="high"][data-surface="paper"]');
  });

  it("keeps listbox menus portal-mounted, viewport-safe, and animated on close", () => {
    expect(listboxSource).toContain("createPortal");
    expect(listboxSource).toContain("calculateListboxMenuPosition");
    expect(listboxSource).toContain('window.addEventListener("scroll", updateMenuPosition, true)');
    expect(listboxSource).toContain('type ListboxMenuPhase = "closed" | "opening" | "open" | "closing"');
    expect(listboxSource).toContain("const menuMounted = menuPhase !== \"closed\"");
    expect(listboxSource).toContain('setMenuPhase("closing")');
    expect(listboxSource).toContain("window.getComputedStyle(menu)");
    expect(listboxSource).toContain("menuRef.current?.contains");
    expect(styles).toMatch(/\.arena-listbox-menu\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*var\(--z-popover\)/s);
    expect(styles).toMatch(/\.arena-listbox-menu\s*\{[^}]*transition:[^}]*var\(--motion-expand\)/s);
    expect(styles).toContain('.arena-listbox-menu[data-placement="above"]');
    expect(styles).toContain('.arena-listbox-menu[data-state="open"]');
  });

  it("keeps the persisted motion control, contrast choices, and translations wired", () => {
    expect(appSource).toContain('style={{ "--motion-scale": appearance.motionScale / 100 }');
    expect(appSource).toContain('id="motion-scale"');
    expect(appSource).toContain("updateAppearance(\"motionScale\", Number(event.target.value))");
    expect(appSource).toContain('data-contrast={appearance.contrastId}');
    expect(appSource).toContain('const { locale } = useI18n();');
    expect(appSource).toContain('translate("Interface language")');
    expect(appSource).toContain('translate("Motion scale")');

    const resourceKeys = new Set(
      [...i18nSource.matchAll(/^(?:\s*)(?:"((?:[^"\\]|\\.)+)"|([A-Za-z][A-Za-z0-9_]*))\s*:/gm)]
        .map((match) => match[1] ?? match[2]),
    );
    const literalCalls = [...appSource.matchAll(/translate\(\s*"((?:[^"\\]|\\.)+)"\s*\)/g)]
      .map((match) => JSON.parse(`"${match[1]}"`));
    const missing = [...new Set(literalCalls.filter((message) => !resourceKeys.has(message)))];
    expect(missing).toEqual([]);
  });

  it("keeps responsive comparison overflow local", () => {
    expect(styles).toMatch(/\.arena-competitor-results\s*\{[^}]*overflow-x:\s*auto/s);
    expect(styles).toMatch(/\.blind-card-grid\s*\{[^}]*overflow-x:\s*auto/s);
    expect(styles).toMatch(/\.arena-live-table\s*\{[^}]*overflow-x:\s*auto/s);
    expect(styles).toMatch(/@media \(max-width: 900px\) \{[\s\S]*?\.models-layout\s*\{[^}]*grid-template-columns:\s*1fr;/s);
  });
});
