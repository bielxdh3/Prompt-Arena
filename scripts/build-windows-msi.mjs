import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readPackageVersion } from "./package-artifacts.mjs";
import { writeRegularFileSync } from "./safe-files.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function wixToolsRoot() {
  const root = process.env.LOCALAPPDATA;
  if (!root) throw new Error("LOCALAPPDATA is unavailable; WiX tools cannot be located");
  const tools = path.join(root, "tauri", "WixTools314");
  for (const name of ["candle.exe", "light.exe", "WixUIExtension.dll"]) {
    if (!fs.existsSync(path.join(tools, name))) throw new Error(`WiX tool is missing: ${path.join(tools, name)}`);
  }
  return tools;
}

function wixAttribute(tag, name) {
  return new RegExp(`\\b${name}="([^"]*)"`, "u").exec(tag)?.[1];
}

const MSI_WORKER_FILENAMES = new Set([
  "prompt-arena-worker.exe",
  "prompt-arena-worker-x86_64-pc-windows-msvc.exe",
]);

// The Tauri WiX template normally uses <File Source="..." KeyPath="yes" />
// without a Name attribute. WiX derives the installed filename from Source.
function wixFileName(fileTag) {
  const explicit = wixAttribute(fileTag, "Name");
  if (explicit) return explicit.toLowerCase();
  const source = wixAttribute(fileTag, "Source");
  if (!source || source.includes("&") || source.includes("$")) return undefined;
  return source.split(/[\\/]/u).at(-1)?.toLowerCase();
}

// This is a narrow check for Tauri's generated WiX fragments, not an XML parser.
// When a future Tauri version changes the shape, refuse to patch the MSI rather
// than risk silently shipping an application without its one-shot worker.
export function inspectWixWorkerPayload(wxs) {
  const references = new Set(
    [...wxs.matchAll(/<ComponentRef\b[^>]*>/gu)]
      .map(([tag]) => wixAttribute(tag, "Id"))
      .filter(Boolean),
  );
  const workers = [];
  for (const component of wxs.matchAll(/<Component\b[^>]*>[\s\S]*?<\/Component>/gu)) {
    const [body] = component;
    const header = /^<Component\b[^>]*>/u.exec(body)?.[0];
    const componentId = header && wixAttribute(header, "Id");
    for (const [fileTag] of body.matchAll(/<File\b[^>]*>/gu)) {
      const name = wixFileName(fileTag);
      if (name && MSI_WORKER_FILENAMES.has(name)) {
        workers.push({ componentId, referenced: references.has(componentId) });
      }
    }
  }
  return workers;
}

function diagnosticToken(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,96}$/u.test(value) ? value : "unavailable";
}

// Safe for PR artifacts: never emit raw XML, paths, WiX variable values,
// installer properties or arbitrary file content. Report only allowlisted
// identifiers and element names from worker-related components.
export function summarizeWixWorkerGraph(contents) {
  const components = [...contents.matchAll(/<Component\b[^>]*>[\s\S]*?<\/Component>/gu)];
  const relevant = components.filter(([body]) => {
    const header = /^<Component\b[^>]*>/u.exec(body)?.[0] ?? "";
    return (wixAttribute(header, "Id") ?? "").toLowerCase().includes("worker")
      || [...body.matchAll(/<File\b[^>]*>/gu)].some(([tag]) => (wixFileName(tag) ?? "").includes("prompt-arena-worker"));
  });
  const lines = [
    `WiX component blocks: ${components.length}`,
    `Worker-related component blocks: ${relevant.length}`,
    `Recognized worker payload files: ${inspectWixWorkerPayload(contents).length}`,
  ];
  for (const [body] of relevant.slice(0, 12)) {
    const header = /^<Component\b[^>]*>/u.exec(body)?.[0] ?? "";
    lines.push(`Component: ${diagnosticToken(wixAttribute(header, "Id"))}`);
    const elements = [...body.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b/gu)]
      .slice(1, 12).map(([, name]) => diagnosticToken(name));
    lines.push(`  Child element names: ${elements.join(", ")}`);
    for (const [tag] of [...body.matchAll(/<File\b[^>]*>/gu)].slice(0, 6)) {
      const explicitName = wixAttribute(tag, "Name");
      const source = wixAttribute(tag, "Source");
      const sourceBasename = source?.split(/[\\/]/u).at(-1);
      const safeSourceBasename = sourceBasename && MSI_WORKER_FILENAMES.has(sourceBasename.toLowerCase())
        ? sourceBasename : "other-or-unavailable";
      lines.push(`  File Id=${diagnosticToken(wixAttribute(tag, "Id"))} Name=${diagnosticToken(explicitName)} SourceBasename=${safeSourceBasename}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

// Traverse only the generated WiX Feature tags, tracking their immediate parent.
// The worker must move from optional Environment into mandatory MainProgram,
// never into another optional child Feature or outside the Feature graph.
function wixFeatures(contents) {
  const features = [];
  const open = [];
  for (const match of contents.matchAll(/<\/?Feature\b[^>]*>/gu)) {
    if (match[0].startsWith("</")) {
      const current = open.pop();
      if (!current) throw new Error("WiX feature nesting is invalid; refusing MSI fallback");
      current.closeStart = match.index;
      continue;
    }
    const feature = {
      id: wixAttribute(match[0], "Id"),
      absent: wixAttribute(match[0], "Absent"),
      parentId: open.at(-1)?.id,
      openStart: match.index,
      openEnd: match.index + match[0].length,
    };
    features.push(feature);
    open.push(feature);
  }
  if (open.length !== 0) throw new Error("WiX feature tags are unbalanced; refusing MSI fallback");
  return features;
}

export function putWorkerInMandatoryFeature(contents, retainedComponentId) {
  if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,95}$/u.test(retainedComponentId)) {
    throw new Error("WiX worker component identifier is invalid");
  }
  const features = wixFeatures(contents);
  const main = features.filter((feature) => feature.id === "MainProgram");
  const environment = features.filter((feature) => feature.id === "Environment");
  if (main.length !== 1 || main[0].absent !== "disallow"
      || environment.length !== 1 || environment[0].parentId !== "MainProgram"
      || environment[0].absent !== "allow") {
    throw new Error("WiX worker feature layout is unfamiliar; refusing to move worker from optional feature");
  }
  const references = [...contents.matchAll(/<ComponentRef\b[^>]*\/>/gu)]
    .filter(([tag]) => wixAttribute(tag, "Id") === retainedComponentId);
  if (references.length !== 1 || references[0].index < environment[0].openEnd
      || references[0].index >= environment[0].closeStart) {
    throw new Error("WiX retained worker is not uniquely referenced from optional Environment feature");
  }
  const reference = references[0];
  const withoutOptionalRef = contents.slice(0, reference.index) + contents.slice(reference.index + reference[0].length);
  return withoutOptionalRef.slice(0, main[0].openEnd)
    + `\n            <ComponentRef Id="${retainedComponentId}"/>`
    + withoutOptionalRef.slice(main[0].openEnd);
}

function saveWixFailureDiagnostics() {
  const directory = process.env.PACKAGE_DIAGNOSTICS_DIR?.trim();
  if (!directory) return;
  const wxsPath = path.join(REPOSITORY_ROOT, "src-tauri", "target", "release", "wix", "x64", "main.wxs");
  if (!fs.existsSync(wxsPath)) return;
  const wxsInfo = fs.lstatSync(wxsPath);
  if (!wxsInfo.isFile() || wxsInfo.isSymbolicLink() || wxsInfo.size > 2 * 1024 * 1024) return;
  fs.mkdirSync(directory, { recursive: true });
  const directoryInfo = fs.lstatSync(directory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) return;
  writeRegularFileSync(path.join(directory, "wix-worker-graph.txt"), summarizeWixWorkerGraph(fs.readFileSync(wxsPath, "utf8")));
}

export function patchDuplicateWorkerComponentContents(contents) {
  const duplicate = /\r?\n\s*<Component\b[^>]*\bId="prompt_arena_worker"[^>]*>[\s\S]*?<\/Component>/gu;
  const matches = [...contents.matchAll(duplicate)];
  const reference = /\r?\n\s*<ComponentRef\b[^>]*\bId="prompt_arena_worker"\s*\/>/gu;
  const refs = [...contents.matchAll(reference)];
  if (matches.length !== 1 || refs.length !== 1) {
    throw new Error("WiX generated worker component/ref is unfamiliar; refusing destructive fallback");
  }
  const removedComponent = matches[0][0];
  const removedBody = /<Component\b[^>]*>([\s\S]*?)<\/Component>/u.exec(removedComponent)?.[1]?.trim();
  const removedFileTag = removedBody && /^<File\b[^>]*\/>$/u.exec(removedBody)?.[0];
  if (!removedFileTag || wixFileName(removedFileTag) !== "prompt-arena-worker.exe") {
    throw new Error("WiX fallback would remove an unknown or multi-resource component; refusing to patch MSI");
  }
  const before = inspectWixWorkerPayload(contents);
  const patched = contents.replace(duplicate, "").replace(reference, "");
  const after = inspectWixWorkerPayload(patched);
  if (before.length < 2 || after.length !== 1 || !after[0].referenced || after[0].componentId === "prompt_arena_worker") {
    throw new Error(
      `WiX fallback would remove the only or unreferenced worker sidecar; refusing to build incomplete MSI `
      + `(source worker files=${before.length}, retained worker files=${after.length}, retained referenced=${after[0]?.referenced === true})`,
    );
  }
  return putWorkerInMandatoryFeature(patched, after[0].componentId);
}

function patchDuplicateWorkerComponent(wxsPath) {
  const original = fs.readFileSync(wxsPath, "utf8");
  const patched = patchDuplicateWorkerComponentContents(original);
  fs.writeFileSync(wxsPath, patched, "utf8");
}

export function verifyMsiWorkerPayload(msiPath) {
  const verifier = path.join(REPOSITORY_ROOT, "scripts", "verify-windows-msi.ps1");
  const status = run("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", verifier, "-MsiPath", msiPath,
  ]);
  if (status !== 0) throw new Error(`MSI worker inclusion verification failed with exit code ${status}`);
}

export function buildPatchedMsi(version, releaseDirectory = path.join(REPOSITORY_ROOT, "src-tauri", "target", "release")) {
  const wixRoot = wixToolsRoot();
  const wixDirectory = path.join(releaseDirectory, "wix", "x64");
  const wxsPath = path.join(wixDirectory, "main.wxs");
  if (!fs.existsSync(wxsPath)) throw new Error(`Tauri did not leave WiX source behind: ${wxsPath}`);
  patchDuplicateWorkerComponent(wxsPath);
  const wixObject = path.join(wixDirectory, "prompt-arena-fixed.wixobj");
  const outputDirectory = path.join(releaseDirectory, "bundle", "msi");
  const outputPath = path.join(outputDirectory, `Prompt Arena_${version}_x64_en-US.msi`);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const candleStatus = run(path.join(wixRoot, "candle.exe"), ["-arch", "x64", "-out", wixObject, wxsPath]);
  if (candleStatus !== 0) throw new Error(`WiX candle.exe failed with exit code ${candleStatus}`);
  const lightStatus = run(path.join(wixRoot, "light.exe"), [
    "-ext", path.join(wixRoot, "WixUIExtension.dll"),
    "-out", outputPath,
    wixObject,
    "-loc", path.join(wixDirectory, "locale.wxl"),
  ]);
  if (lightStatus !== 0) throw new Error(`WiX light.exe failed with exit code ${lightStatus}`);
  const metadata = fs.statSync(outputPath);
  if (!metadata.isFile() || metadata.size === 0) throw new Error(`WiX produced an empty MSI: ${outputPath}`);
  verifyMsiWorkerPayload(outputPath);
  return outputPath;
}

function tauriMsiCandidates() {
  const directory = path.join(REPOSITORY_ROOT, "src-tauri", "target", "release", "bundle", "msi");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".msi"))
    .map((entry) => path.join(directory, entry.name));
}

// Generated bundle output is disposable; repository-published QA artifacts live
// under downloadable-artifacts and are never touched by this cleanup.
export function prepareGeneratedMsiOutput(repositoryRoot = REPOSITORY_ROOT) {
  const directory = path.resolve(repositoryRoot, "src-tauri", "target", "release", "bundle", "msi");
  const targetRoot = path.resolve(repositoryRoot, "src-tauri", "target");
  if (path.dirname(directory) !== path.join(targetRoot, "release", "bundle")) {
    throw new Error("MSI output directory escaped the generated target root");
  }
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
    return directory;
  }
  const metadata = fs.lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error("MSI output directory is not a real directory");
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isFile()) fs.unlinkSync(target);
    else if (entry.isDirectory() && !entry.isSymbolicLink()) fs.rmSync(target, { recursive: true, force: true });
    else throw new Error(`MSI output contains an unsafe entry: ${entry.name}`);
  }
  return directory;
}

export function buildWindowsMsi() {
  if (process.platform !== "win32") throw new Error("Windows MSI build must run on Windows");
  const version = readPackageVersion(REPOSITORY_ROOT);
  prepareGeneratedMsiOutput();
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  // The MSI embeds Microsoft's Evergreen installer so clean installs do not
  // depend on an unbounded WebView2 bootstrapper download.
  const tauriStatus = run(npmCommand, [
    "run", "tauri:build", "--", "--bundles", "msi", "--config", "src-tauri/tauri.msi.conf.json",
  ], { shell: true });
  const candidates = tauriMsiCandidates().filter((candidate) => fs.statSync(candidate).size > 0);
  if (tauriStatus === 0 && candidates.length === 1) {
    verifyMsiWorkerPayload(candidates[0]);
    return candidates[0];
  }
  return buildPatchedMsi(version);
}

function isMainModule() {
  return process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  try {
    const outputPath = buildWindowsMsi();
    console.log(`Windows MSI ready: ${outputPath}`);
  } catch (error) {
    try { saveWixFailureDiagnostics(); }
    catch { /* Preserve the real WiX failure if diagnostic capture is unavailable. */ }
    console.error(error instanceof Error ? error.message : "Windows MSI build failed.");
    process.exitCode = 1;
  }
}
