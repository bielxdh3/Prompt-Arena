import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readPackageVersion } from "./package-artifacts.mjs";

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

function patchDuplicateWorkerComponent(wxsPath) {
  const contents = fs.readFileSync(wxsPath, "utf8");
  const duplicate = /\r?\n\s*<Component Id="prompt_arena_worker"[\s\S]*?<\/Component>/u;
  if (!duplicate.test(contents) || !contents.includes('<ComponentRef Id="prompt_arena_worker"/>')) {
    throw new Error("WiX output did not contain the known duplicate worker component");
  }
  const patched = contents.replace(duplicate, "").replace(/\r?\n\s*<ComponentRef Id="prompt_arena_worker"\/>/u, "");
  fs.writeFileSync(wxsPath, patched, "utf8");
}

function buildPatchedMsi(version) {
  const wixRoot = wixToolsRoot();
  const wixDirectory = path.join(REPOSITORY_ROOT, "src-tauri", "target", "release", "wix", "x64");
  const wxsPath = path.join(wixDirectory, "main.wxs");
  if (!fs.existsSync(wxsPath)) throw new Error(`Tauri did not leave WiX source behind: ${wxsPath}`);
  patchDuplicateWorkerComponent(wxsPath);
  const wixObject = path.join(wixDirectory, "prompt-arena-fixed.wixobj");
  const outputDirectory = path.join(REPOSITORY_ROOT, "src-tauri", "target", "release", "bundle", "msi");
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
  return outputPath;
}

function tauriMsiCandidates() {
  const directory = path.join(REPOSITORY_ROOT, "src-tauri", "target", "release", "bundle", "msi");
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".msi"))
    .map((entry) => path.join(directory, entry.name));
}

export function buildWindowsMsi() {
  if (process.platform !== "win32") throw new Error("Windows MSI build must run on Windows");
  const version = readPackageVersion(REPOSITORY_ROOT);
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const tauriStatus = run(npmCommand, ["run", "tauri:build", "--", "--bundles", "msi"], { shell: true });
  const candidates = tauriMsiCandidates().filter((candidate) => fs.statSync(candidate).size > 0);
  if (tauriStatus === 0 && candidates.length === 1) return candidates[0];
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
    console.error(error instanceof Error ? error.message : "Windows MSI build failed.");
    process.exitCode = 1;
  }
}
