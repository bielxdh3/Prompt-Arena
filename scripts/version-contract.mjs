import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readJsonVersion(filePath) {
  const value = JSON.parse(readText(filePath)).version;
  if (typeof value !== "string" || !value.trim()) throw new Error(`missing version in ${filePath}`);
  return value.trim();
}

function readCargoVersion(filePath) {
  const match = /^version\s*=\s*"([^"]+)"/mu.exec(readText(filePath));
  if (!match) throw new Error(`missing package version in ${filePath}`);
  return match[1];
}

function readLockedPackageVersion(filePath) {
  const match = /name\s*=\s*"prompt-arena"\r?\nversion\s*=\s*"([^"]+)"/u.exec(readText(filePath));
  if (!match) throw new Error(`missing prompt-arena package version in ${filePath}`);
  return match[1];
}

export function readVersionContract(repositoryRoot = REPOSITORY_ROOT) {
  const packageLock = JSON.parse(readText(path.join(repositoryRoot, "package-lock.json")));
  const rootPackage = packageLock.packages?.[""];
  if (!rootPackage || typeof rootPackage.version !== "string") throw new Error("missing root package-lock version");
  return {
    packageJson: readJsonVersion(path.join(repositoryRoot, "package.json")),
    packageLock: packageLock.version,
    packageLockRoot: rootPackage.version,
    tauri: readJsonVersion(path.join(repositoryRoot, "src-tauri", "tauri.conf.json")),
    cargoToml: readCargoVersion(path.join(repositoryRoot, "src-tauri", "Cargo.toml")),
    cargoLock: readLockedPackageVersion(path.join(repositoryRoot, "src-tauri", "Cargo.lock")),
  };
}

export function assertSynchronizedVersion(repositoryRoot = REPOSITORY_ROOT) {
  const versions = readVersionContract(repositoryRoot);
  const unique = new Set(Object.values(versions));
  if (unique.size !== 1) {
    throw new Error(`package versions are out of sync: ${Object.entries(versions).map(([name, version]) => `${name}=${version}`).join(", ")}`);
  }
  const [version] = unique;
  if (!VERSION_PATTERN.test(version)) throw new Error(`package version must be MAJOR.MINOR.PATCH: ${version}`);
  return version;
}

export function incrementPatchVersion(version) {
  if (!VERSION_PATTERN.test(version)) throw new Error(`package version must be MAJOR.MINOR.PATCH: ${version}`);
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function replaceOnce(contents, pattern, replacement, description) {
  const updated = contents.replace(pattern, replacement);
  if (updated === contents) throw new Error(`could not update ${description}`);
  return updated;
}

export function writeSynchronizedVersion(version, repositoryRoot = REPOSITORY_ROOT) {
  if (!VERSION_PATTERN.test(version)) throw new Error(`package version must be MAJOR.MINOR.PATCH: ${version}`);
  const packagePath = path.join(repositoryRoot, "package.json");
  const lockPath = path.join(repositoryRoot, "package-lock.json");
  const tauriPath = path.join(repositoryRoot, "src-tauri", "tauri.conf.json");
  const cargoPath = path.join(repositoryRoot, "src-tauri", "Cargo.toml");
  const cargoLockPath = path.join(repositoryRoot, "src-tauri", "Cargo.lock");

  fs.writeFileSync(packagePath, replaceOnce(readText(packagePath), /("version"\s*:\s*")[^"]+(")/u, `$1${version}$2`, packagePath), "utf8");
  let lock = replaceOnce(readText(lockPath), /("version"\s*:\s*")[^"]+(",\s*"lockfileVersion")/u, `$1${version}$2`, lockPath);
  lock = replaceOnce(lock, /(\n\s*""\s*:\s*\{\s*\n\s*"name"\s*:\s*"prompt-arena",\s*\n\s*"version"\s*:\s*")[^"]+(")/u, `$1${version}$2`, `${lockPath} root package`);
  fs.writeFileSync(lockPath, lock, "utf8");
  fs.writeFileSync(tauriPath, replaceOnce(readText(tauriPath), /("version"\s*:\s*")[^"]+(")/u, `$1${version}$2`, tauriPath), "utf8");
  fs.writeFileSync(cargoPath, replaceOnce(readText(cargoPath), /(^version\s*=\s*")[^"]+(")/mu, `$1${version}$2`, cargoPath), "utf8");
  fs.writeFileSync(cargoLockPath, replaceOnce(readText(cargoLockPath), /(name\s*=\s*"prompt-arena"\r?\nversion\s*=\s*")[^"]+(")/u, `$1${version}$2`, cargoLockPath), "utf8");
}

function isMainModule() {
  return process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  try {
    console.log(`Synchronized package version: ${assertSynchronizedVersion()}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Version contract failed.");
    process.exitCode = 1;
  }
}
