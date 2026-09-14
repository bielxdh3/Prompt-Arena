import fs from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { PT_BR_MESSAGES } from "../src/i18n";

const surfaces = ["App.tsx", "advanced-arena-view.tsx", "roadmap-features-view.tsx", "human-error.tsx", "technical-details.tsx"];

describe("human UX regressions", () => {
  it("covers shared-component labels and literal translations in every major surface", () => {
    const missing = [];
    const technical = new Set(["RAM", "GPU", "VRAM", "compile-time target"]);
    for (const file of surfaces) {
      const source = ts.createSourceFile(file, fs.readFileSync(`src/${file}`, "utf8"), ts.ScriptTarget.Latest, true);
      function check(value) {
        if (!Object.hasOwn(PT_BR_MESSAGES, value) && !technical.has(value)) missing.push(`${file}: ${value}`);
      }
      function visit(node) {
        if (ts.isCallExpression(node) && node.expression.getText(source) === "translate" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) check(node.arguments[0].text);
        if (ts.isJsxAttribute(node) && ["label", "description", "detail", "title", "actionLabel"].includes(node.name.getText(source)) && node.initializer && ts.isStringLiteral(node.initializer)) check(node.initializer.text);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("keeps packaged Windows entry points in the GUI subsystem", () => {
    expect(fs.readFileSync("src-tauri/src/main.rs", "utf8")).toContain('#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]');
  });

  it("does not introduce malformed source text during localization", () => {
    for (const file of [...surfaces, "arena-ui.ts", "display-names.ts", "i18n.ts"]) {
      expect(fs.readFileSync(`src/${file}`, "utf8"), file).not.toContain("\uFFFD");
    }
  });
});
