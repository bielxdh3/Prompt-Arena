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
const advancedSource = read("src/advanced-arena-view.tsx");
const roadmapSource = read("src/roadmap-features-view.tsx");

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
    expect(styles).toMatch(/\.app-shell\s*\{[\s\S]*?--orbit-outer-duration:\s*max\(/s);
    expect(styles).toMatch(/\.app-shell\s*\{[\s\S]*?--orbit-middle-duration:\s*max\(/s);
    expect(styles.match(/--orbit-outer-duration:\s*max\(/g)?.length ?? 0).toBe(1);
    expect(styles.match(/--orbit-middle-duration:\s*max\(/g)?.length ?? 0).toBe(1);
    expect(styles).toMatch(/\.orbit-outer\s*\{[\s\S]*?animation:\s*orbit-ring-outer[^;]*linear infinite;/s);
    expect(styles).toMatch(/\.orbit-middle\s*\{[\s\S]*?animation:\s*orbit-ring-middle[^;]*linear infinite;/s);
    expect(styles).not.toMatch(/\.orbit-middle\s*\{[^}]*animation:[^;]*reverse/s);
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
    expect(appSource).toContain("requestAnimationFrame(revealVisibleTargets)");
    expect(appSource).toContain("observer?.unobserve(entry.target)");
    expect(appSource).toContain('className="page-transition"');
    const orbitMarkup = appSource.match(/<div className="hero-orbit"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect((orbitMarkup.match(/<svg className="orbit orbit-(?:outer|middle)"/g) ?? []).length).toBe(2);
    expect((orbitMarkup.match(/<ellipse /g) ?? []).length).toBe(2);
    expect(orbitMarkup).toContain('<div className="orbit-core">PA</div>');
    expect(advancedSource).toContain('translate("Advanced Arena")');
    expect(advancedSource).toContain('translate("Quality, latency, throughput, and human signal")');
    expect(roadmapSource).toContain('translate("Single-model benchmark")');
    expect(roadmapSource).toContain('translate("Performance Lab")');
    expect(roadmapSource).toContain('cancelRunOnce');
    expect(roadmapSource).toContain('aria-label={translate("Cancel run")}');
    expect(roadmapSource).toContain('() => cancellationRef.current?.shouldContinue() ?? false');

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

  it("keeps historical sources distinguishable and scrollable by keyboard, and gates unsupported repro runtimes", () => {
    expect(roadmapSource).toContain('numberedName("Arena", summary.arenaId, comparableArenaSummaries.map((item) => item.arenaId))');
    expect(roadmapSource).toContain('translate("Whole Arena run")');
    expect(roadmapSource).not.toContain("describeArenaCompetitors");
    expect(roadmapSource).not.toContain("competitor.competitorId");
    expect(roadmapSource).not.toContain("competitor.competitorLabel");
    expect(roadmapSource).toContain('formatLocaleDate(summary.createdAt)');
    expect(roadmapSource).toContain('summary.blind === false || revealedArenaIds.has(summary.arenaId)');
    expect(roadmapSource).toContain('arenaSummaryIdentityRevealed(summary, readBlindEvaluation)');
    expect(advancedSource).toContain('arenaSummaryIdentityRevealed(summary, readBlindEvaluation)');
    expect(advancedSource).toContain('calibrationResults.filter((record) => hasVisibleSource(record.sourceArenaId, record.sourceContentHash))');
    expect(advancedSource).toContain('tournamentResults.filter((record) => hasVisibleSource(record.sourceArenaId, record.sourceContentHash))');
    expect(roadmapSource).toContain('historicalRegressionSourcesVisible(comparison, state.records, comparableArenaSummaries)');
    expect(roadmapSource).toContain('ratingOutcomesFromArenaSummaries(revealedArenaSummaries)');
    expect(appSource).toContain('arenaSummaryIdentityRevealed(record, readBlindEvaluation)');
    expect(appSource).toContain('identityRevealed && <ArenaSummaryExportActions record={record} />');
    expect(appSource).toContain('const showMeasuredResults = !showBlindEvaluation;');
    expect(roadmapSource).toContain('role="region" aria-label={translate("Saved comparisons")} tabIndex={0}');
    expect(roadmapSource).toContain('const importedRuntimeSupportsLiveIdentity = importedBundle?.profileRevision.runtime === "ollama";');
    expect(roadmapSource).toContain('&& importedRuntimeSupportsLiveIdentity');
    expect(roadmapSource).toContain(': runRequest.profileRevision.runtime !== "ollama"');
    expect(roadmapSource).toContain('translate("The imported benchmark and saved profile match local records, but this runtime does not provide the live model identity check required for Re-run. Re-running is disabled.")');
  });

  it("pads the Insights preview root panel as well as its nested panels", () => {
    expect(roadmapSource).toContain('className="panel roadmap-features-view"');
    expect(styles).toMatch(/\.roadmap-features-view\.panel\s*\{[^}]*padding:\s*clamp\(20px,\s*3vw,\s*32px\)/s);
  });

  it("connects robustness history to comparison and hash-linked export", () => {
    expect(roadmapSource).toContain('id="insights-robustness-baseline"');
    expect(roadmapSource).toContain('id="insights-robustness-candidate"');
    expect(roadmapSource).toContain('onClick={compareSavedRobustnessResults}');
    expect(roadmapSource).toContain('onClick={() => void exportSavedRobustnessComparison()}');
    expect(roadmapSource).toContain('download={`prompt-arena-robustness-comparison-');
    expect(roadmapSource).toContain('setRobustnessBaselineId(selectedRobustnessBaseline.recordId);');
    expect(roadmapSource).toContain('setRobustnessCandidateId(selectedRobustnessCandidate.recordId);');
    expect(roadmapSource).toContain('${displayName(result.taskId, "Task")} / ${displayName(result.caseId, "Case")}');
    expect(roadmapSource).toContain('${recordId}`');
    expect(roadmapSource).toContain('translate("Robustness comparison exports include prompt variants and saved results. Review the file before sharing.")');
  });
});
