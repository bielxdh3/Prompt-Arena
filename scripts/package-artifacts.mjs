import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/u;

export const CHECKSUM_MANIFEST_NAME = "checksums-sha256.txt";
export const PACKAGE_ARTIFACT_SPECS = Object.freeze({
  windows: Object.freeze([
    Object.freeze({ kind: "nsis", bundleDirectory: "nsis", extension: "exe", required: true, suffix: "-setup.exe" }),
    Object.freeze({ kind: "msi", bundleDirectory: "msi", extension: "msi", required: false, suffix: ".msi" }),
  ]),
  linux: Object.freeze([
    Object.freeze({ kind: "deb", bundleDirectory: "deb", extension: "deb", required: true, suffix: ".deb" }),
    Object.freeze({ kind: "appimage", bundleDirectory: "appimage", extension: "AppImage", required: true, suffix: ".appimage" }),
  ]),
});

export function normalizePlatform(platform) {
  if (platform === "windows" || platform === "linux") return platform;
  throw new Error(`unsupported packaging platform: ${String(platform || "missing")}`);
}

export function hostPackagingPlatform() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "linux") return "linux";
  throw new Error(`unsupported packaging host: ${process.platform}`);
}

export function normalizePackageVersion(version) {
  const normalized = String(version ?? "").trim();
  if (!VERSION_PATTERN.test(normalized)) throw new Error(`invalid package version: ${normalized || "missing"}`);
  return normalized;
}

export function packageArtifactName(platform, version, kind) {
  const normalizedPlatform = normalizePlatform(platform);
  const normalizedVersion = normalizePackageVersion(version);
  const spec = PACKAGE_ARTIFACT_SPECS[normalizedPlatform].find((candidate) => candidate.kind === kind);
  if (!spec) throw new Error(`unsupported ${normalizedPlatform} package kind: ${String(kind)}`);
  return `prompt-arena-${normalizedVersion}-${normalizedPlatform}-${spec.kind}.${spec.extension}`;
}

export function packageArtifactNames(platform, version) {
  const normalizedPlatform = normalizePlatform(platform);
  return PACKAGE_ARTIFACT_SPECS[normalizedPlatform].map(({ kind }) => packageArtifactName(normalizedPlatform, version, kind));
}

export function readPackageVersion(repositoryRoot = REPOSITORY_ROOT) {
  const configPath = path.join(repositoryRoot, "src-tauri", "tauri.conf.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return normalizePackageVersion(config.version);
}

export function sha256File(filePath) {
  const metadata = fs.lstatSync(filePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`checksum input is not a regular file: ${filePath}`);
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function safeManifestName(name) {
  if (
    typeof name !== "string"
    || !name
    || name === "."
    || name === ".."
    || name.includes("\0")
    || name.includes("/")
    || name.includes("\\")
    || name.includes("\r")
    || name.includes("\n")
  ) {
    throw new Error(`checksum manifest contains an unsafe filename: ${String(name)}`);
  }
  return name;
}

function manifestEntry(entry) {
  if (!entry || typeof entry !== "object") throw new Error("checksum manifest entry is invalid");
  const name = safeManifestName(entry.name);
  const sha256 = typeof entry.sha256 === "string" ? entry.sha256.toLowerCase() : "";
  if (!/^[a-f0-9]{64}$/u.test(sha256)) throw new Error(`checksum is invalid for ${name}`);
  return { name, sha256 };
}

export function renderChecksumManifest(entries) {
  const normalized = entries.map(manifestEntry).sort((left, right) => (
    left.name === right.name ? 0 : left.name < right.name ? -1 : 1
  ));
  const names = new Set();
  for (const entry of normalized) {
    if (names.has(entry.name)) throw new Error(`checksum manifest contains a duplicate filename: ${entry.name}`);
    names.add(entry.name);
  }
  return `${normalized.map(({ sha256, name }) => `${sha256}  ${name}`).join("\n")}\n`;
}

export function parseChecksumManifest(contents) {
  if (typeof contents !== "string") throw new Error("checksum manifest is not text");
  const lines = contents.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0 || lines.some((line) => !line)) throw new Error("checksum manifest is empty or contains a blank line");
  return lines.map((line) => {
    const match = /^([a-f0-9]{64})  (.+)$/iu.exec(line);
    if (!match) throw new Error(`checksum manifest line is invalid: ${line}`);
    return manifestEntry({ sha256: match[1], name: match[2] });
  });
}

export function verifyChecksumManifest(manifestPath, artifactDirectory) {
  const root = path.resolve(artifactDirectory);
  const entries = parseChecksumManifest(fs.readFileSync(manifestPath, "utf8"));
  const names = new Set();
  for (const entry of entries) {
    if (names.has(entry.name)) throw new Error(`checksum manifest contains a duplicate filename: ${entry.name}`);
    names.add(entry.name);
    const artifactPath = path.resolve(root, entry.name);
    if (path.dirname(artifactPath) !== root) throw new Error(`checksum artifact escapes its directory: ${entry.name}`);
    if (sha256File(artifactPath) !== entry.sha256) throw new Error(`checksum mismatch for ${entry.name}`);
  }
  return entries;
}

function ensureDirectory(directory) {
  if (fs.existsSync(directory)) {
    const metadata = fs.lstatSync(directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`packaging directory is not a real directory: ${directory}`);
    return;
  }
  fs.mkdirSync(directory, { recursive: true });
}

function bundleCandidates(bundleRoot, spec) {
  const directory = path.join(bundleRoot, spec.bundleDirectory);
  if (!fs.existsSync(directory)) return [];
  const metadata = fs.lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`bundle directory is not a real directory: ${directory}`);
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(spec.suffix.toLowerCase()))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function selectBundleArtifact(bundleRoot, spec) {
  const candidates = bundleCandidates(bundleRoot, spec);
  if (candidates.length > 1) throw new Error(`multiple ${spec.kind} bundle artifacts found: ${candidates.join(", ")}`);
  if (candidates.length === 0) {
    if (spec.required) throw new Error(`required ${spec.kind} bundle artifact was not produced`);
    return null;
  }
  return candidates[0];
}

function removeExpectedOutput(target) {
  if (!fs.existsSync(target)) return;
  const metadata = fs.lstatSync(target);
  if (metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`packaging output is not a regular file: ${target}`);
  fs.unlinkSync(target);
}

export function preparePackageArtifacts(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? REPOSITORY_ROOT);
  const platform = normalizePlatform(options.platform ?? hostPackagingPlatform());
  const version = normalizePackageVersion(options.version ?? readPackageVersion(repositoryRoot));
  const bundleRoot = path.resolve(options.bundleRoot ?? path.join(repositoryRoot, "src-tauri", "target", "release", "bundle"));
  const outputDirectory = path.resolve(options.outputDirectory ?? path.join(repositoryRoot, "package-artifacts"));
  const manifestPath = path.resolve(options.manifestPath ?? path.join(repositoryRoot, CHECKSUM_MANIFEST_NAME));
  const selections = PACKAGE_ARTIFACT_SPECS[platform].map((spec) => ({
    spec,
    source: selectBundleArtifact(bundleRoot, spec),
    name: packageArtifactName(platform, version, spec.kind),
  }));

  ensureDirectory(outputDirectory);
  const artifacts = [];
  const missingOptional = [];
  for (const selection of selections) {
    const target = path.join(outputDirectory, selection.name);
    if (selection.source) {
      removeExpectedOutput(target);
      fs.copyFileSync(selection.source, target);
      artifacts.push({ name: selection.name, path: target, sha256: sha256File(target) });
    } else {
      removeExpectedOutput(target);
      missingOptional.push(selection.spec.kind);
    }
  }

  artifacts.sort((left, right) => (left.name === right.name ? 0 : left.name < right.name ? -1 : 1));
  const manifestDirectory = path.dirname(manifestPath);
  ensureDirectory(manifestDirectory);
  if (fs.existsSync(manifestPath)) {
    const metadata = fs.lstatSync(manifestPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error(`checksum manifest path is not a regular file: ${manifestPath}`);
  }
  fs.writeFileSync(manifestPath, renderChecksumManifest(artifacts), "utf8");
  return { platform, version, artifacts, manifestPath, missingOptional };
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) throw new Error(`unknown packaging argument: ${argument}`);
    const key = argument.slice(2);
    if (!["platform", "version", "bundle-root", "output-directory", "manifest-path"].includes(key)) {
      throw new Error(`unknown packaging option: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`packaging option requires a value: ${argument}`);
    options[key.replaceAll("-", "")] = value;
    index += 1;
  }
  return {
    platform: options.platform,
    version: options.version,
    bundleRoot: options.bundleroot,
    outputDirectory: options.outputdirectory,
    manifestPath: options.manifestpath,
  };
}

function isMainModule() {
  return process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  try {
    const result = preparePackageArtifacts(parseCliArgs(process.argv.slice(2)));
    console.log(`Prepared ${result.artifacts.length} ${result.platform} package artifact(s) for ${result.version}.`);
    if (result.missingOptional.length > 0) console.log(`Optional artifacts unavailable: ${result.missingOptional.join(", ")}.`);
    console.log(`Wrote ${result.manifestPath}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Package artifact preparation failed.");
    process.exitCode = 1;
  }
}
