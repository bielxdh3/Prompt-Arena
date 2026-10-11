import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  inspectWixWorkerPayload,
  patchDuplicateWorkerComponentContents,
  prepareGeneratedMsiOutput,
  summarizeWixWorkerGraph,
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
</DirectoryRef><Feature Id="MainProgram" Level="1" Absent="disallow">
  <ComponentRef Id="RegistryEntries"/>
  <Feature Id="ShortcutsFeature" Level="1"><ComponentRef Id="Path"/></Feature>
  <Feature Id="Environment" Level="1" Absent="allow">
    <ComponentRef Id="prompt_arena_worker"/>
    <ComponentRef Id="retained_worker"/>
  </Feature>
</Feature></Fragment></Wix>`;

  it("patches a duplicate worker only with another referenced worker component remaining", () => {
    const patched = patchDuplicateWorkerComponentContents(duplicateFixture);
    expect(patched).not.toContain('<Component Id="prompt_arena_worker"');
    expect(patched).not.toContain('<ComponentRef Id="prompt_arena_worker"');
    expect(inspectWixWorkerPayload(patched)).toEqual([{ componentId: "retained_worker", referenced: true }]);
    const mainDirect = patched.slice(patched.indexOf('<Feature Id="MainProgram"'), patched.indexOf('<Feature Id="ShortcutsFeature"'));
    const optional = patched.slice(patched.indexOf('<Feature Id="Environment"'), patched.indexOf('</Feature>', patched.indexOf('<Feature Id="Environment"')));
    expect(mainDirect).toContain('<ComponentRef Id="retained_worker"/>');
    expect(optional).not.toContain('<ComponentRef Id="retained_worker"/>');
  });

  it("accepts the Tauri-generated File Source-only worker component without Name", () => {
    const tauri = duplicateFixture.replace(
      'Id="WorkerDuplicate" Name="prompt-arena-worker.exe" Source=',
      'Id="Bin_prompt_arena_worker" Source=',
    ).replace(' Source="C:\\build\\prompt-arena-worker.exe" />\n  </Component>\n</DirectoryRef>', ' Source="C:\\build\\prompt-arena-worker.exe" />\n  </Component>\n</DirectoryRef>');
    expect(tauri).not.toContain('Id="Bin_prompt_arena_worker" Name=');
    const patched = patchDuplicateWorkerComponentContents(tauri);
    expect(inspectWixWorkerPayload(patched)).toEqual([{ componentId: "retained_worker", referenced: true }]);
  });

  it("preserves an externalBin resource where both worker File nodes rely on Source filenames", () => {
    const tauri = duplicateFixture
      .replace('Id="WorkerDuplicate" Name="prompt-arena-worker.exe"', 'Id="Bin_prompt_arena_worker"')
      .replace('Id="WorkerCanonical" Name="prompt-arena-worker.exe" Source="C:\\build\\prompt-arena-worker.exe"',
        'Id="Resource_worker" Source="C:\\build\\binaries\\prompt-arena-worker-x86_64-pc-windows-msvc.exe"');
    const patched = patchDuplicateWorkerComponentContents(tauri);
    expect(inspectWixWorkerPayload(patched)).toEqual([{ componentId: "retained_worker", referenced: true }]);
    expect(patched).toContain('Id="Resource_worker"');
    expect(patched).not.toContain('Id="Bin_prompt_arena_worker"');
  });

  it("produces bounded WiX failure diagnostics without leaking source paths or secrets", () => {
    const fixture = duplicateFixture.replace(
      'Source="C:\\build\\prompt-arena-worker.exe"',
      'Source="C:\\secret-value\\prompt-arena-worker.exe"',
    ) + '<Component Id="other"><File Id="Secret" Source="C:\\private\\token-string"/></Component>';
    const report = summarizeWixWorkerGraph(fixture);
    expect(report).toContain("Worker-related component blocks: 2");
    expect(report).toContain("SourceBasename=prompt-arena-worker.exe");
    expect(report).not.toContain("secret-value");
    expect(report).not.toContain("token-string");
    expect(report).not.toContain("C:\\");
    expect(report.length).toBeLessThan(2000);
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

  it("moves the real Tauri source-only worker to mandatory MainProgram, not optional Environment", () => {
    const realTauri = `<?xml version="1.0"?><Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
<DirectoryRef Id="INSTALLDIR">
  <Component Id="Path" Guid="*"><File Id="Path" Source="C:\\app\\prompt-arena.exe" KeyPath="yes"/></Component>
  <Component Id="prompt_arena_worker.exe" Guid="*">
    <File Id="Bin_prompt_arena_worker.exe" Source="C:\\Temp\\prompt-arena-worker.exe" KeyPath="yes"/>
  </Component>
  <Component Id="prompt_arena_worker" Guid="*">
    <File Id="Bin_prompt_arena_worker" Source="E:\\build\\target\\release\\prompt-arena-worker.exe" KeyPath="yes"/>
  </Component>
</DirectoryRef>
<Feature
  Id="MainProgram" Level="1" ConfigurableDirectory="INSTALLDIR" Absent="disallow">
  <ComponentRef Id="RegistryEntries"/>
  <Feature Id="ShortcutsFeature" Title="Shortcuts" Level="1">
    <ComponentRef Id="Path"/>
  </Feature>
  <Feature Id="Environment" Title="PATH Environment Variable" Level="1" Absent="allow">
    <ComponentRef Id="Path"/>
    <ComponentRef Id="prompt_arena_worker.exe"/>
    <ComponentRef Id="prompt_arena_worker"/>
  </Feature>
</Feature></Wix>`;
    const patched = patchDuplicateWorkerComponentContents(realTauri);
    expect(inspectWixWorkerPayload(patched)).toEqual([{ componentId: "prompt_arena_worker.exe", referenced: true }]);
    expect(patched).not.toContain('Id="Bin_prompt_arena_worker"');
    expect(patched.match(/<ComponentRef Id="prompt_arena_worker\.exe"\/>/gu)).toHaveLength(1);
    const mandatory = patched.slice(patched.indexOf('Id="MainProgram"'), patched.indexOf('Id="ShortcutsFeature"'));
    const optional = patched.slice(patched.indexOf('Id="Environment"'), patched.indexOf('</Feature>', patched.indexOf('Id="Environment"')));
    expect(mandatory).toContain('<ComponentRef Id="prompt_arena_worker.exe"/>');
    expect(optional).not.toContain('prompt_arena_worker.exe');
    expect(optional).toContain('<ComponentRef Id="Path"/>');
  });

  it("fails closed if worker belongs to an unknown optional feature or MainProgram is not compulsory", () => {
    expect(() => patchDuplicateWorkerComponentContents(
      duplicateFixture.replace('Id="MainProgram" Level="1" Absent="disallow"', 'Id="MainProgram" Level="1" Absent="allow"'),
    )).toThrow('worker feature layout is unfamiliar');
    expect(() => patchDuplicateWorkerComponentContents(
      duplicateFixture.replace('Id="Environment" Level="1" Absent="allow"', 'Id="Custom" Level="1" Absent="allow"'),
    )).toThrow('worker feature layout is unfamiliar');
    expect(() => patchDuplicateWorkerComponentContents(
      duplicateFixture.replace('<ComponentRef Id="retained_worker"/>', '<ComponentRef Id="retained_worker"/><ComponentRef Id="retained_worker"/>'),
    )).toThrow('not uniquely referenced');
  });
});
