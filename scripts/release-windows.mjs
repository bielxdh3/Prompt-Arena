import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertSynchronizedVersion, incrementPatchVersion, writeSynchronizedVersion } from "./version-contract.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOWNLOAD_DIRECTORY = path.join(REPOSITORY_ROOT, "downloadable-artifacts");
const README_PATH = path.join(REPOSITORY_ROOT, "README.md");
const README_START = "<!-- WINDOWS_MSI_DOWNLOAD:START -->";
const README_END = "<!-- WINDOWS_MSI_DOWNLOAD:END -->";
const SNAPSHOT_PATHS = [
  "package.json",
  "package-lock.json",
  "README.md",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];

function git(args, options = {}) {
  return execFileSync("git", args, { cwd: REPOSITORY_ROOT, encoding: "utf8", stdio: options.stdio ?? ["ignore", "pipe", "pipe"] }).trim();
}

function run(command, args) {
  execFileSync(command, args, { cwd: REPOSITORY_ROOT, stdio: "inherit" });
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function msiSource() {
  const directory = path.join(REPOSITORY_ROOT, "src-tauri", "target", "release", "bundle", "msi");
  const candidates = fs.existsSync(directory)
    ? fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".msi")).map((entry) => path.join(directory, entry.name))
    : [];
  if (candidates.length !== 1) throw new Error(`expected exactly one MSI from Tauri, found ${candidates.length}`);
  return candidates[0];
}

function updateReadme(version, filename, sha256, sourceCommit) {
  const contents = fs.readFileSync(README_PATH, "utf8");
  const start = contents.indexOf(README_START);
  const end = contents.indexOf(README_END);
  if (start < 0 || end < start) throw new Error("README Windows MSI markers are missing or invalid");
  const body = [
    README_START,
    `[Download Prompt Arena ${version} for Windows (MSI)](downloadable-artifacts/${filename})`,
    `SHA-256: \`${sha256}\``,
    `Built from product commit: \`${sourceCommit}\``,
    README_END,
  ].join("\n");
  fs.writeFileSync(README_PATH, `${contents.slice(0, start)}${body}${contents.slice(end + README_END.length)}`, "utf8");
}

function snapshot() {
  return new Map(SNAPSHOT_PATHS.map((relativePath) => [relativePath, fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath))]));
}

function restore(snapshotFiles) {
  for (const [relativePath, contents] of snapshotFiles) fs.writeFileSync(path.join(REPOSITORY_ROOT, relativePath), contents);
}

function isMainModule() {
  return process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  const snapshotFiles = snapshot();
  let artifactPath;
  let checksumPath;
  let committed = false;
  let staged = false;
  try {
    if (process.platform !== "win32") throw new Error("Windows MSI release must run on Windows");
    if (git(["status", "--porcelain"])) throw new Error("working tree must be clean before a release");
    const branch = git(["symbolic-ref", "--short", "HEAD"]);
    if (!branch) throw new Error("release requires a named branch");
    const sourceCommit = git(["rev-parse", "HEAD"]);
    const currentVersion = assertSynchronizedVersion();
    const version = incrementPatchVersion(currentVersion);
    const filename = `Prompt-Arena-${version}-windows-x64.msi`;
    artifactPath = path.join(DOWNLOAD_DIRECTORY, filename);
    checksumPath = `${artifactPath}.sha256`;

    writeSynchronizedVersion(version);
    run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "tauri:build", "--", "--bundles", "msi"]);
    const sourcePath = msiSource();
    fs.mkdirSync(DOWNLOAD_DIRECTORY, { recursive: true });
    if (fs.existsSync(artifactPath) || fs.existsSync(checksumPath)) throw new Error(`release artifact already exists: ${filename}`);
    fs.copyFileSync(sourcePath, artifactPath);
    const sha256 = sha256File(artifactPath);
    fs.writeFileSync(checksumPath, `${sha256}  ${filename}\n`, "utf8");
    updateReadme(version, filename, sha256, sourceCommit);

    run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "check:version"]);
    run("git", ["diff", "--check"]);
    run("git", ["add", ...SNAPSHOT_PATHS, path.relative(REPOSITORY_ROOT, artifactPath), path.relative(REPOSITORY_ROOT, checksumPath)]);
    staged = true;
    run("git", ["commit", "-m", `release(windows): publish Prompt Arena ${version} MSI`]);
    committed = true;
    run("git", ["push", "origin", branch]);
    console.log(`Published ${filename} (${sha256}) from product commit ${sourceCommit}.`);
  } catch (error) {
    if (!committed) {
      if (staged) {
        try {
          git(["restore", "--staged", "--", ...SNAPSHOT_PATHS, path.relative(REPOSITORY_ROOT, artifactPath ?? "downloadable-artifacts"), path.relative(REPOSITORY_ROOT, checksumPath ?? "downloadable-artifacts")]);
        } catch { /* keep the original blocker */ }
      }
      if (artifactPath && fs.existsSync(artifactPath)) fs.unlinkSync(artifactPath);
      if (checksumPath && fs.existsSync(checksumPath)) fs.unlinkSync(checksumPath);
      restore(snapshotFiles);
    }
    console.error(error instanceof Error ? `Windows MSI release blocked: ${error.message}` : "Windows MSI release blocked.");
    process.exitCode = 1;
  }
}
