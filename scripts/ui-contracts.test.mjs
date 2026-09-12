import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const styles = fs.readFileSync(path.join(repositoryRoot, "src", "styles.css"), "utf8");
const listboxSource = fs.readFileSync(path.join(repositoryRoot, "src", "accessible-listbox.tsx"), "utf8");
const i18nSource = fs.readFileSync(path.join(repositoryRoot, "src", "i18n.ts"), "utf8");
const appSource = fs.readFileSync(path.join(repositoryRoot, "src", "App.tsx"), "utf8");
const shippedUiSources = ["App.tsx", "advanced-arena-view.tsx"].map((fileName) => fs.readFileSync(path.join(repositoryRoot, "src", fileName), "utf8"));

function contrastRatio(foreground, background) {
  const channel = (value) => {
    const normalized = value / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex) => {
    const rgb = hex.slice(1).match(/.{2}/g).map((value) => Number.parseInt(value, 16));
    return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function paperToken(block, token) {
  const value = block.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
  if (!value) throw new Error(`Missing Paper token ${token}`);
  return value;
}

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
    expect(appSource).toContain("requestAnimationFrame(revealVisibleTargets)");
    expect(appSource).toContain("observer?.unobserve(entry.target)");
    expect(styles).toMatch(/details\.motion-disclosure\[open\][\s\S]*transition-delay:\s*var\(--motion-stagger\)/);
    const formerFiniteMotion = {
      "--motion-fast-base": 200,
      "--motion-base-base": 314,
      "--motion-page-base": 360,
      "--motion-surface-base": 286,
      "--motion-reveal-base": 160,
      "--motion-disclosure-base": 320,
      "--motion-stagger-base": 48,
    };
    const currentFiniteMotion = {
      "--motion-fast-base": 1000,
      "--motion-base-base": 1570,
      "--motion-page-base": 1800,
      "--motion-surface-base": 1430,
      "--motion-reveal-base": 800,
      "--motion-disclosure-base": 1600,
      "--motion-stagger-base": 240,
    };
    for (const [token, formerValue] of Object.entries(formerFiniteMotion)) {
      const currentValue = currentFiniteMotion[token];
      expect(styles).toMatch(new RegExp(`${token}:\\s*${currentValue}ms`));
      expect(currentValue / formerValue).toBe(5);
    }
    expect(styles).toMatch(/--motion-page:\s*calc\(\s*var\(--motion-page-base\)\s*\*\s*var\(--motion-scale-effective\)\s*\)/);
    expect(styles).toContain("transition-behavior: allow-discrete");
    expect(styles).toContain("content-visibility: hidden");
    expect(styles).not.toContain("--motion-orbit-period");
    expect(styles).not.toMatch(/orbit-(?:rotate|one-rotate|two-rotate)/);
    expect(styles).toMatch(/@keyframes orbit-ring-(?:outer|middle)/);
    expect(styles).not.toMatch(/@keyframes orbit-ring-inner/);
    expect(styles).toMatch(/\.orbit-outer\s*\{[^}]*animation:\s*orbit-ring-outer\s+var\(--orbit-outer-duration\)/s);
    expect(styles).toMatch(/\.orbit-middle\s*\{[^}]*animation:\s*orbit-ring-middle\s+var\(--orbit-middle-duration\)[^}]*reverse/s);
    expect(styles).toMatch(/--orbit-outer-period:\s*3\.2s/);
    expect(styles).toMatch(/--orbit-middle-period:\s*2\.4s/);
    expect(styles).not.toContain("--orbit-inner-period");
    expect(styles).toMatch(/\.orbit-(?:outer|middle)\s*\{[^}]*animation:/s);
    expect(styles).not.toMatch(/\.orbit-(?:outer|middle|inner)\s*\{[^}]*border-(?:top|right|bottom|left)-color/s);
    expect(styles).toMatch(/\.hero-orbit \.orbit\s*\{\s*animation:\s*none !important;/s);
    expect(styles).toMatch(/\.app-shell\[data-reduced-motion="true"\][\s\S]*transition-duration:\s*0\.01ms/s);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*--motion-scale-effective:\s*0/s);

    const paperBlock = styles.match(/\.app-shell\[data-surface="paper"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(paperBlock).toMatch(/--color-canvas:\s*#c8bfb0/);
    expect(paperBlock).toMatch(/--color-surface:\s*#d7cdbd/);
    expect(paperBlock).toMatch(/--color-accent-strong:\s*#6d4512/);
    expect(paperBlock).toMatch(/--color-focus:\s*#51370e/);
    expect(paperBlock).not.toMatch(/--color-(?:canvas|surface|surface-raised|surface-soft|surface-muted):\s*#fff/i);
    const paperSurface = paperToken(paperBlock, "--color-surface");
    expect(contrastRatio(paperToken(paperBlock, "--color-text"), paperSurface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(paperToken(paperBlock, "--color-text-muted"), paperSurface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(paperToken(paperBlock, "--color-accent-strong"), paperSurface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(paperToken(paperBlock, "--color-focus"), paperSurface)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(paperToken(paperBlock, "--color-border-strong"), paperSurface)).toBeGreaterThanOrEqual(3);
    expect(styles).toMatch(/\.workspace,[\s\S]*\.advanced-textarea\s*\{[^}]*scrollbar-color:/s);
    expect(styles).toMatch(/\.app-shell\[data-contrast="high"\]\s*\{[^}]*--scrollbar-thumb:/s);
    expect(styles).toMatch(/\.app-shell\[data-contrast="high"\]\[data-surface="paper"\]/);
    expect(styles).toMatch(/\.model-list-panel > \.profile-records,[\s\S]*\.profile-panel > \.profile-records\s*\{[^}]*margin-top:\s*var\(--space-section\)/s);
    expect((appSource.match(/<details className="[^"]*motion-disclosure/g) ?? []).length).toBeGreaterThan(0);
  });

  it("keeps the accessible persisted motion-scale control wired to the app shell", () => {
    expect(appSource).toContain('style={{ "--motion-scale": appearance.motionScale / 100 }');
    expect(appSource).toMatch(/id="motion-scale"[\s\S]*type="range"[\s\S]*min=\{MOTION_SCALE_MIN\}[\s\S]*max=\{MOTION_SCALE_MAX\}/);
    expect(appSource).toContain("aria-valuetext={`${appearance.motionScale}%`}");
    expect(appSource).toContain('updateAppearance("motionScale", Number(event.target.value))');
    expect(i18nSource).toMatch(/"Motion scale"\s*:/);
    expect(i18nSource).toMatch(/"Adjust the duration of discretionary interface motion\."\s*:/);
    expect((appSource.match(/type="range"/g) ?? []).length).toBe(1);
    expect(appSource).not.toContain('id="font-scale"');
    const motionControlIndex = appSource.indexOf('id="motion-scale"');
    const reduceMotionIndex = appSource.indexOf('className="appearance-toggle motion-toggle"');
    const firstAppearanceFieldsetIndex = appSource.indexOf('<fieldset className="appearance-fieldset">');
    expect(motionControlIndex).toBeGreaterThan(-1);
    expect(reduceMotionIndex).toBeGreaterThan(motionControlIndex);
    expect(firstAppearanceFieldsetIndex).toBeGreaterThan(reduceMotionIndex);
    const orbitMarkup = appSource.match(/<div className="hero-orbit"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect((orbitMarkup.match(/<svg className="orbit orbit-(?:outer|middle)"/g) ?? []).length).toBe(2);
    expect((orbitMarkup.match(/<ellipse /g) ?? []).length).toBe(2);
    expect(orbitMarkup).toContain('<div className="orbit-core">PA</div>');
    expect(orbitMarkup).not.toContain("orbit-inner");
    expect(orbitMarkup).not.toMatch(/dot|ball|bead|particle/i);
    expect(styles).not.toMatch(/\.orbit-core\s*\{[^}]*animation:/s);
    expect(appSource).not.toContain("nav-item-description");
    expect(styles).not.toContain(".nav-item-description");
  });

  it("keeps listbox menus attached, viewport-safe, and shared across consumers", () => {
    expect(listboxSource).toContain("createPortal");
    expect(listboxSource).toContain("calculateListboxMenuPosition");
    expect(listboxSource).toContain('data-placement={menuPosition?.placement}');
    expect(listboxSource).toContain('closest<HTMLElement>(".app-shell")');
    expect(listboxSource).toContain('window.addEventListener("scroll", updateMenuPosition, true)');
    expect(listboxSource).toContain("menuRef.current?.contains");
    expect(listboxSource).toContain('type ListboxMenuPhase = "closed" | "opening" | "open" | "closing"');
    expect(listboxSource).toContain('const menuMounted = menuPhase !== "closed"');
    expect(listboxSource).toContain('setMenuPhase("closing")');
    expect(listboxSource).toContain('data-state={menuPhase}');
    expect(listboxSource).toContain("window.requestAnimationFrame");
    expect(listboxSource).toContain("window.getComputedStyle(menu)");
    expect(listboxSource).toContain("setMenuPhase(\"closed\")");
    expect(styles).toMatch(/\.arena-listbox-menu\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*var\(--z-popover\)/s);
    expect(styles).not.toMatch(/\.arena-listbox-menu\s*\{[^}]*position:\s*absolute/s);
    expect(styles).toMatch(/\.arena-listbox-menu\s*\{[^}]*transition:[^}]*var\(--motion-expand\)/s);
    expect(styles).toMatch(/\.arena-listbox-menu\[data-state="open"\]\s*\{[^}]*opacity:\s*1;[^}]*transform:/s);
    expect(styles).toMatch(/\.arena-listbox-menu\[data-placement="above"\]/);
    expect(styles).not.toMatch(/\.arena-listbox-menu\s*\{[^}]*transition:[^}]*\d+ms/s);
  });
});
