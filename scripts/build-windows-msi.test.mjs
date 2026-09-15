import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { prepareGeneratedMsiOutput } from "./build-windows-msi.mjs";

const temporaryRoots = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Windows MSI generated-output hygiene", () => {
  it("removes stale generated MSI files without touching published QA artifacts", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-arena-msi-"));
    temporaryRoots.push(root);
    const output = path.join(root, "src-tauri", "target", "release", "bundle", "msi");
    const published = path.join(root, "downloadable-artifacts");
    fs.mkdirSync(path.join(output, "stale-directory"), { recursive: true });
    fs.mkdirSync(published, { recursive: true });
    fs.writeFileSync(path.join(output, "Prompt Arena_0.1.3_x64.msi"), "stale");
    fs.writeFileSync(path.join(output, "stale-directory", "old.wixobj"), "stale");
    fs.writeFileSync(path.join(published, "Prompt-Arena-qa.msi"), "published");

    expect(prepareGeneratedMsiOutput(root)).toBe(output);
    expect(fs.readdirSync(output)).toEqual([]);
    expect(fs.readFileSync(path.join(published, "Prompt-Arena-qa.msi"), "utf8")).toBe("published");
  });
});

