import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CHECKSUM_MANIFEST_NAME,
  PACKAGE_ARTIFACT_SPECS,
  hostPackagingPlatform,
  normalizePlatform,
  packageArtifactName,
  readPackageVersion,
  verifyChecksumManifest,
} from "./package-artifacts.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SMOKE_WAIT_MS = 2_500;
const SMOKE_TERMINATION_WAIT_MS = 5_000;
const UNINSTALL_DISAPPEAR_WAIT_MS = 5_000;
const UNINSTALL_POLL_INTERVAL_MS = 100;

export function readPackageMetadata(repositoryRoot = REPOSITORY_ROOT) {
  const configPath = path.join(repositoryRoot, "src-tauri", "tauri.conf.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const identifier = typeof config.identifier === "string" ? config.identifier.trim() : "";
  const productName = typeof config.productName === "string" ? config.productName.trim() : "";
  const mainBinaryName = typeof config.mainBinaryName === "string" && config.mainBinaryName.trim()
    ? config.mainBinaryName.trim()
    : "prompt-arena";
  if (!identifier || !productName || !mainBinaryName) throw new Error("Tauri package metadata is incomplete");
  return {
    identifier,
    productName,
    mainBinaryName,
    version: readPackageVersion(repositoryRoot),
  };
}

export function verifyPackageArtifacts({ platform, version, artifactDirectory, manifestPath }) {
  const normalizedPlatform = normalizePlatform(platform);
  const entries = verifyChecksumManifest(manifestPath, artifactDirectory);
  const expectedSpecs = PACKAGE_ARTIFACT_SPECS[normalizedPlatform];
  const expectedNames = new Set(expectedSpecs.map(({ kind }) => packageArtifactName(normalizedPlatform, version, kind)));
  const listedNames = new Set(entries.map(({ name }) => name));
  for (const spec of expectedSpecs) {
    const name = packageArtifactName(normalizedPlatform, version, spec.kind);
    const listed = listedNames.has(name);
    if (spec.required && !listed) throw new Error(`required checksum entry is missing: ${name}`);
    if (listed && fs.statSync(path.join(artifactDirectory, name)).size === 0) throw new Error(`package artifact is empty: ${name}`);
  }
  for (const entry of entries) {
    if (!expectedNames.has(entry.name)) throw new Error(`unexpected package artifact name: ${entry.name}`);
  }
  return {
    platform: normalizedPlatform,
    version,
    entries,
    optionalMissing: expectedSpecs
      .filter((spec) => !spec.required && !listedNames.has(packageArtifactName(normalizedPlatform, version, spec.kind)))
      .map(({ kind }) => kind),
  };
}

function commandAvailable(command) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  try {
    execFileSync(locator, [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isRegularFile(filePath) {
  try {
    const metadata = fs.lstatSync(filePath);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

function walkFiles(rootDirectory, maxDepth = 5) {
  if (!fs.existsSync(rootDirectory)) return [];
  const files = [];
  const pending = [{ directory: rootDirectory, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current.directory, { withFileTypes: true })) {
      const entryPath = path.join(current.directory, entry.name);
      if (entry.isFile()) files.push(entryPath);
      else if (entry.isDirectory() && current.depth < maxDepth) pending.push({ directory: entryPath, depth: current.depth + 1 });
    }
  }
  return files.sort((left, right) => (left === right ? 0 : left < right ? -1 : 1));
}

export function findInstalledExecutable(installDirectory, productName, mainBinaryName) {
  const preferredNames = new Set([
    `${mainBinaryName}.exe`.toLowerCase(),
    `${productName}.exe`.toLowerCase(),
    "prompt-arena.exe",
  ]);
  const candidates = walkFiles(installDirectory)
    .filter((filePath) => filePath.toLowerCase().endsWith(".exe"))
    .filter((filePath) => !/(?:uninstall|worker)/i.test(path.basename(filePath)));
  const preferred = candidates.find((filePath) => preferredNames.has(path.basename(filePath).toLowerCase()));
  if (preferred) return preferred;
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 0) throw new Error("installed Prompt Arena executable was not found");
  throw new Error(`installed executable is ambiguous: ${candidates.join(", ")}`);
}

function findUninstaller(installDirectory) {
  const uninstaller = walkFiles(installDirectory).find((filePath) => /^uninstall.*\.exe$/iu.test(path.basename(filePath)));
  if (!uninstaller) throw new Error("NSIS uninstaller was not found in the installed directory");
  return uninstaller;
}

async function waitForPathToDisappear(filePath) {
  const deadline = Date.now() + UNINSTALL_DISAPPEAR_WAIT_MS;
  while (fs.existsSync(filePath)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, UNINSTALL_POLL_INTERVAL_MS));
  }
  return true;
}

function launchCommand(executable, args) {
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return { command: executable, args };
  if (commandAvailable("xvfb-run")) return { command: "xvfb-run", args: ["-a", executable, ...args] };
  return null;
}

function launchAndStop(command, args) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let terminationTimer;
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true });
    const clearTimers = () => {
      clearTimeout(timer);
      if (terminationTimer) clearTimeout(terminationTimer);
    };
    const resolveStopped = () => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve({ stayedRunning: true });
    };
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill();
      terminationTimer = setTimeout(resolveStopped, SMOKE_TERMINATION_WAIT_MS);
    }, SMOKE_WAIT_MS);
    child.once("error", (error) => {
      if (settled || timedOut) return;
      settled = true;
      clearTimers();
      reject(new Error(`could not launch ${command}: ${error.message}`));
    });
    const handleTermination = (code, signal) => {
      if (timedOut) {
        resolveStopped();
        return;
      }
      if (settled) return;
      settled = true;
      clearTimers();
      if (code !== null && code !== 0) reject(new Error(`${command} exited with code ${code}${signal ? ` (${signal})` : ""}`));
      else resolve({ stayedRunning: false });
    };
    child.once("exit", handleTermination);
    child.once("close", () => {
      if (timedOut) resolveStopped();
    });
  });
}

async function windowsSmoke(artifactDirectory, metadata, lines) {
  if (process.platform !== "win32") {
    lines.push("NSIS clean-install smoke: skipped (the current runner is not Windows).");
    return;
  }
  const installer = path.join(artifactDirectory, packageArtifactName("windows", metadata.version, "nsis"));
  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-arena-p7-windows-"));
  const installDirectory = path.join(smokeRoot, "installed");
  try {
    execFileSync(installer, ["/S", `/D=${installDirectory}`], { stdio: "ignore", timeout: 120_000 });
    const executable = findInstalledExecutable(installDirectory, metadata.productName, metadata.mainBinaryName);
    lines.push(`NSIS clean install: passed (${path.basename(executable)}).`);
    await launchAndStop(executable, []);
    lines.push("Installed executable start: passed.");
    await launchAndStop(executable, []);
    lines.push("Installed executable restart: passed.");
    const uninstaller = findUninstaller(installDirectory);
    execFileSync(uninstaller, ["/S"], { stdio: "ignore", timeout: 120_000 });
    if (!(await waitForPathToDisappear(executable))) throw new Error("NSIS uninstall left the installed executable behind after the removal wait");
    lines.push("NSIS silent uninstall: passed.");
  } finally {
    fs.rmSync(smokeRoot, { recursive: true, force: true, maxRetries: 3 });
  }
}

async function linuxSmoke(artifactDirectory, metadata, lines) {
  if (process.platform !== "linux") {
    lines.push("Linux package/app smoke: skipped (the current runner is not Linux).");
    return;
  }
  if (!commandAvailable("dpkg-deb")) throw new Error("Linux package smoke unavailable: dpkg-deb is not installed");
  const deb = path.join(artifactDirectory, packageArtifactName("linux", metadata.version, "deb"));
  const appImage = path.join(artifactDirectory, packageArtifactName("linux", metadata.version, "appimage"));
  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-arena-p7-linux-"));
  try {
    execFileSync("dpkg-deb", ["--info", deb], { stdio: "ignore", timeout: 30_000 });
    const extracted = path.join(smokeRoot, "deb");
    fs.mkdirSync(extracted);
    execFileSync("dpkg-deb", ["--extract", deb, extracted], { stdio: "ignore", timeout: 30_000 });
    const debExecutable = path.join(extracted, "usr", "bin", metadata.mainBinaryName);
    if (!isRegularFile(debExecutable)) throw new Error(`Deb package executable was not found: usr/bin/${metadata.mainBinaryName}`);
    lines.push("Deb package metadata and extraction: passed.");
    const debCommand = launchCommand(debExecutable, []);
    if (!debCommand) lines.push("Deb application launch: skipped (no graphical session or xvfb-run is available).");
    else {
      await launchAndStop(debCommand.command, debCommand.args);
      lines.push("Deb application launch: passed.");
      await launchAndStop(debCommand.command, debCommand.args);
      lines.push("Deb application restart: passed.");
    }

    execFileSync(appImage, ["--appimage-version"], { stdio: "ignore", timeout: 30_000 });
    lines.push("AppImage runtime validation: passed.");
    const appImageCommand = launchCommand(appImage, ["--appimage-extract-and-run"]);
    if (!appImageCommand) lines.push("AppImage application launch: skipped (no graphical session or xvfb-run is available).");
    else {
      await launchAndStop(appImageCommand.command, appImageCommand.args);
      lines.push("AppImage application launch: passed.");
      await launchAndStop(appImageCommand.command, appImageCommand.args);
      lines.push("AppImage application restart: passed.");
    }
  } finally {
    fs.rmSync(smokeRoot, { recursive: true, force: true, maxRetries: 3 });
  }
}

function ensureEvidenceParent(evidencePath) {
  const parent = path.dirname(evidencePath);
  if (fs.existsSync(parent)) {
    const metadata = fs.lstatSync(parent);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`evidence directory is not a real directory: ${parent}`);
  } else {
    fs.mkdirSync(parent, { recursive: true });
  }
}

function writeEvidence(evidencePath, lines) {
  ensureEvidenceParent(evidencePath);
  if (fs.existsSync(evidencePath) && fs.lstatSync(evidencePath).isSymbolicLink()) throw new Error(`evidence path is a symlink: ${evidencePath}`);
  fs.writeFileSync(evidencePath, `${lines.join("\n")}\n`, "utf8");
}

function parseCliArgs(argv) {
  const options = { smoke: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--smoke" || argument === "--install") {
      options.smoke = true;
      continue;
    }
    if (!["--platform", "--artifact-directory", "--manifest-path", "--evidence-file"].includes(argument)) {
      throw new Error(`unknown package verification option: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`package verification option requires a value: ${argument}`);
    options[argument.slice(2).replaceAll("-", "")] = value;
    index += 1;
  }
  return options;
}

function isMainModule() {
  return process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  const lines = ["Prompt Arena package verification"];
  let evidencePath = path.resolve(REPOSITORY_ROOT, "package-verification.txt");
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const repositoryRoot = REPOSITORY_ROOT;
    const metadata = readPackageMetadata(repositoryRoot);
    const platform = normalizePlatform(options.platform ?? hostPackagingPlatform());
    const artifactDirectory = path.resolve(repositoryRoot, options.artifactdirectory ?? "package-artifacts");
    const manifestPath = path.resolve(repositoryRoot, options.manifestpath ?? CHECKSUM_MANIFEST_NAME);
    evidencePath = path.resolve(repositoryRoot, options.evidencefile ?? "package-verification.txt");
    const result = verifyPackageArtifacts({ platform, version: metadata.version, artifactDirectory, manifestPath });
    lines.push(`Checksum manifest: passed (${result.entries.length} artifact(s)).`);
    if (result.optionalMissing.length > 0) lines.push(`Optional artifacts unavailable: ${result.optionalMissing.join(", ")}.`);
    if (options.smoke) {
      if (platform === "windows") await windowsSmoke(artifactDirectory, metadata, lines);
      else await linuxSmoke(artifactDirectory, metadata, lines);
    } else {
      lines.push("Clean-install/app smoke: not requested.");
    }
    lines.push("Result: passed.");
    writeEvidence(evidencePath, lines);
    console.log(lines.join("\n"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Package verification failed.";
    lines.push(`Result: failed — ${message}`);
    try {
      writeEvidence(evidencePath, lines);
    } catch {
      // Preserve the original verification failure when evidence cannot be written.
    }
    console.error(message);
    process.exitCode = 1;
  }
}
