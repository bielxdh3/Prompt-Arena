import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  inspectWixWorkerPayload,
  patchDuplicateWorkerComponentContents,
  prepareGeneratedMsiOutput,
} from "./build-windows-msi.mjs";

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

  const duplicateFixture = `<?xml version="1.0"?>
<Wix><Fragment><DirectoryRef Id="APPLICATIONFOLDER">
  <Component Id="prompt_arena_worker" Guid="*">
    <File Id="WorkerDuplicate" Name="prompt-arena-worker.exe" Source="C:\\build\\prompt-arena-worker.exe" />
  </Component>
  <Component Id="retained_worker" Guid="*">
    <File Id="WorkerCanonical" Name="prompt-arena-worker.exe" Source="C:\\build\\prompt-arena-worker.exe" />
  </Component>
</DirectoryRef><ComponentGroup Id="Main">
  <ComponentRef Id="prompt_arena_worker"/>
  <ComponentRef Id="retained_worker"/>
</ComponentGroup></Fragment></Wix>`;

  it("patches a duplicate worker only with another referenced worker component remaining", () => {
    const patched = patchDuplicateWorkerComponentContents(duplicateFixture);
    expect(patched).not.toContain('<Component Id="prompt_arena_worker"');
    expect(patched).not.toContain('<ComponentRef Id="prompt_arena_worker"');
    expect(inspectWixWorkerPayload(patched)).toEqual([{ componentId: "retained_worker", referenced: true }]);
  });

  it("recognizes a referenced target-triple resource worker without requiring it beside the app", () => {
    const resource = duplicateFixture.replace(
      '<File Id="WorkerCanonical" Name="prompt-arena-worker.exe"',
      '<File Id="WorkerCanonical" Name="prompt-arena-worker-x86_64-pc-windows-msvc.exe"',
    );
    const patched = patchDuplicateWorkerComponentContents(resource);
    expect(inspectWixWorkerPayload(patched)).toEqual([{ componentId: "retained_worker", referenced: true }]);
    // Directory placement is verified against the linked MSI Directory table,
    // not guessed from the source WiX component name.
  });

  it("fails closed when removing a generated component would omit the worker", () => {
    const onlyWorker = duplicateFixture.replace(/\s*<Component Id="retained_worker"[\s\S]*?<\/Component>/u, "")
      .replace(/\s*<ComponentRef Id="retained_worker"\/>/u, "");
    expect(() => patchDuplicateWorkerComponentContents(onlyWorker)).toThrow("only or unreferenced worker sidecar");
  });

  it("fails closed when the remaining worker is not feature-referenced or not named correctly", () => {
    const unreferenced = duplicateFixture.replace(/\s*<ComponentRef Id="retained_worker"\/>/u, "");
    expect(() => patchDuplicateWorkerComponentContents(unreferenced)).toThrow("only or unreferenced worker sidecar");
    const wronglyNamed = duplicateFixture.replace('Name="prompt-arena-worker.exe" Source="C:\\build\\prompt-arena-worker.exe" />\n  </Component>\n</DirectoryRef>', 'Name="renamed-worker.exe" Source="C:\\build\\prompt-arena-worker.exe" />\n  </Component>\n</DirectoryRef>');
    expect(inspectWixWorkerPayload(wronglyNamed)).toHaveLength(1);
    expect(() => patchDuplicateWorkerComponentContents(wronglyNamed)).toThrow("only or unreferenced worker sidecar");
  });

  it("never strips additional resources alongside a duplicated worker", () => {
    const unsafe = duplicateFixture.replace(
      '<File Id="WorkerDuplicate" Name="prompt-arena-worker.exe" Source="C:\\build\\prompt-arena-worker.exe" />',
      '<File Id="WorkerDuplicate" Name="prompt-arena-worker.exe" Source="C:\\build\\prompt-arena-worker.exe" />\n    <RegistryValue Name="important" Value="keep" />',
    );
    expect(() => patchDuplicateWorkerComponentContents(unsafe)).toThrow("unknown or multi-resource");
  });

  it("rejects unknown and ambiguous generated WiX component graphs", () => {
    expect(() => patchDuplicateWorkerComponentContents(duplicateFixture.replace(/<ComponentRef Id="prompt_arena_worker"\/>/u, ""))).toThrow("unfamiliar");
    expect(() => patchDuplicateWorkerComponentContents(duplicateFixture.replace(/<Component Id="prompt_arena_worker"/u, '<Component Id="other_worker"'))).toThrow("unfamiliar");
  });
});
