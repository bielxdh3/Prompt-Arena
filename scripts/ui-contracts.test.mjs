import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const styles = fs.readFileSync(path.join(repositoryRoot, "src", "styles.css"), "utf8");
const i18nSource = fs.readFileSync(path.join(repositoryRoot, "src", "i18n.ts"), "utf8");
const shippedUiSources = ["App.tsx", "advanced-arena-view.tsx"].map((fileName) => fs.readFileSync(path.join(repositoryRoot, "src", fileName), "utf8"));
const translatingComponentProps = {
  MetricCard: ["label", "detail"],
  StateMessage: ["title", "description"],
  EmptyState: ["title", "description", "actionLabel"],
  BoundaryRow: ["label"],
  FormInput: ["label"],
  FormTextArea: ["label"],
  AdvancedMetric: ["label", "detail"],
  AdvancedStateMessage: ["title", "description"],
  AdvancedEmptyState: ["title", "description"],
  AdvancedBoundary: ["label"],
  AdvancedSelect: ["label", "placeholder"],
};

function findComponentOpeningTags(source) {
  const names = Object.keys(translatingComponentProps).join("|");
  const tags = [];
  for (const match of source.matchAll(new RegExp(`<(${names})\\b`, "g"))) {
    const start = match.index;
    let braceDepth = 0;
    let quote = null;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === "\\") index += 1;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
      } else if (character === "{") {
        braceDepth += 1;
      } else if (character === "}") {
        braceDepth -= 1;
      } else if (character === ">" && braceDepth === 0) {
        tags.push(source.slice(start, index + 1));
        break;
      }
    }
  }
  return tags;
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
    const missing = shippedUiSources.flatMap((source) => {
      const directMessages = [...source.matchAll(/translate\(\s*"((?:[^"\\]|\\.)+)"\s*\)/g)].map((match) => JSON.parse(`"${match[1]}"`));
      const conditionalMessages = [...source.matchAll(/translate\((?:[^()"']|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')*\?[^()]*\)/g)].flatMap((match) => [...match[0].matchAll(/(?:\?|:)\s*"((?:[^"\\]|\\.)+)"/g)].map((branch) => JSON.parse(`"${branch[1]}"`)));
      return [...directMessages, ...conditionalMessages];
    }).filter((message, index, calls) => !resourceKeys.has(message) && calls.indexOf(message) === index);
    expect(missing).toEqual([]);
  });

  it("covers literal props passed to translating components", () => {
    const resourceKeys = new Set([...i18nSource.matchAll(/^(?:\s*)(?:"((?:[^"\\]|\\.)+)"|([A-Za-z][A-Za-z0-9_]*))\s*:/gm)].map((match) => match[1] ?? match[2]));
    const missing = shippedUiSources.flatMap((source) => findComponentOpeningTags(source).flatMap((tag) => {
      const component = /^<(\w+)/u.exec(tag)?.[1];
      if (!component) return [];
      return translatingComponentProps[component].flatMap((prop) => [...tag.matchAll(new RegExp(`\\b${prop}\\s*=\\s*(?:"([^"]+)"|'([^']+)')`, "g"))]
        .map((match) => ({ component, prop, message: match[1] ?? match[2] })));
    })).filter(({ message }) => !resourceKeys.has(message)).map(({ component, prop, message }) => `${component}.${prop}: ${message}`);
    expect(missing).toEqual([]);
  });
});
