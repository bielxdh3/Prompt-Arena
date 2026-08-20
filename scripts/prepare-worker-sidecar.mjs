import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKER_BINARY_NAME = "prompt-arena-worker";
const TAURI_CONFIG_WITHOUT_SIDECAR = JSON.stringify({ bundle: { externalBin: null } });
const TARGET_TRIPLE_PATTERN = /^[a-z0-9_]+(?:-[a-z0-9_]+)+$/;

function normalizedTargetTriple(targetTriple) {
  const normalized = String(targetTriple ?? "").trim();
  if (!TARGET_TRIPLE_PATTERN.test(normalized)) {
    throw new Error(`invalid Rust target triple: ${normalized || "missing"}`);
  }
  return normalized;
}

export function targetPlatform(targetTriple) {
  const normalized = normalizedTargetTriple(targetTriple);
  if (/-windows-[a-z0-9_]+$/.test(normalized)) return "windows";
  if (/-linux-[a-z0-9_]+$/.test(normalized)) return "linux";
  throw new Error(`worker sidecar supports Windows/Linux targets only: ${normalized}`);
}

export function workerSidecarName(targetTriple) {
  const normalized = normalizedTargetTriple(targetTriple);
  const extension = targetPlatform(normalized) === "windows" ? ".exe" : "";
  return `${WORKER_BINARY_NAME}-${normalized}${extension}`;
}

export function workerArtifactPath(repositoryRoot, targetTriple) {
  const normalized = normalizedTargetTriple(targetTriple);
  const extension = targetPlatform(normalized) === "windows" ? ".exe" : "";
  return path.join(
    repositoryRoot,
    "src-tauri",
    "target",
    normalized,
    "release",
    `${WORKER_BINARY_NAME}${extension}`,
  );
}

export function workerSidecarPath(repositoryRoot, targetTriple) {
  return path.join(repositoryRoot, "src-tauri", "binaries", workerSidecarName(targetTriple));
}

export function targetTripleFromRustc(versionOutput) {
  const match = /^host:\s*(\S+)$/m.exec(versionOutput);
  if (!match) throw new Error("rustc -vV did not report a host target triple");
  return normalizedTargetTriple(match[1]);
}

function currentTargetTriple() {
  const configured = process.env.TAURI_ENV_TARGET_TRIPLE?.trim();
  if (configured) return normalizedTargetTriple(configured);
  return targetTripleFromRustc(execFileSync("rustc", ["-vV"], { encoding: "utf8" }));
}

export function prepareWorkerSidecar({ repositoryRoot = REPOSITORY_ROOT, targetTriple = currentTargetTriple() } = {}) {
  const normalized = normalizedTargetTriple(targetTriple);
  const platform = targetPlatform(normalized);
  const source = workerArtifactPath(repositoryRoot, normalized);
  const destination = workerSidecarPath(repositoryRoot, normalized);

  execFileSync(
    "cargo",
    [
      "build",
      "--release",
      "--locked",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--bin",
      WORKER_BINARY_NAME,
      "--target",
      normalized,
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        TAURI_CONFIG: TAURI_CONFIG_WITHOUT_SIDECAR,
        TAURI_ENV_TARGET_TRIPLE: normalized,
      },
      stdio: "inherit",
    },
  );

  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error(`Cargo did not produce the worker artifact: ${source}`);
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  if (platform === "linux") fs.chmodSync(destination, 0o755);
  return { destination, source, targetTriple: normalized };
}

function isMainModule() {
  return process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  const result = prepareWorkerSidecar();
  console.log(`Prepared ${result.destination} for ${result.targetTriple}.`);
}
