import { execFile, execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
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
import { writeRegularFileSync } from "./safe-files.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SMOKE_WAIT_MS = 2_500;
const SMOKE_TERMINATION_WAIT_MS = 5_000;
const UNINSTALL_DISAPPEAR_WAIT_MS = 5_000;
const UNINSTALL_POLL_INTERVAL_MS = 100;
// This is a real failure threshold, not a workaround for the unknown hang.
const MSI_TIMEOUT_MS = 10 * 60_000;
const MSI_DIAGNOSTIC_POLL_MS = 15_000;
const MSI_LOG_TAIL_BYTES = 96 * 1024;
const MSI_PREFLIGHT_TIMEOUT_MS = 20_000;
const MSI_PROCESS_PROBE_INTERVAL_MS = 30_000;
const MSI_PROCESS_PROBE_TIMEOUT_MS = 8_000;

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

export function windowsInstallerPath(artifactDirectory, version, kind) {
  return path.join(artifactDirectory, packageArtifactName("windows", version, kind));
}

export function verifyInstalledWorker(installDirectory, repositoryRoot = REPOSITORY_ROOT) {
  const built = path.join(repositoryRoot, "src-tauri", "binaries", "prompt-arena-worker-x86_64-pc-windows-msvc.exe");
  // Tauri's Windows Resource directory is the app executable's directory.
  // resolve_worker_executable() accepts exactly these two app-owned layouts.
  const candidates = [
    path.join(installDirectory, "prompt-arena-worker.exe"),
    path.join(installDirectory, "binaries", "prompt-arena-worker-x86_64-pc-windows-msvc.exe"),
  ];
  const installed = candidates.filter(isRegularFile);
  if (installed.length !== 1) {
    throw new Error(`installed MSI must contain exactly one Tauri-resolvable app-owned worker sidecar (found ${installed.length})`);
  }
  if (!isRegularFile(built)) throw new Error("built Windows worker sidecar is unavailable for MSI integrity comparison");
  const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (digest(installed[0]) !== digest(built)) throw new Error("installed MSI worker content differs from the built app-owned sidecar");
  return installed[0];
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

export function buildMsiexecArguments(action, installer, installDirectory, logPath) {
  const msi = quoteMsiexecPath(installer, "MSI installer path");
  const log = quoteMsiexecPath(logPath, "MSI log path");
  if (action === "install") {
    const directory = quoteMsiexecPath(installDirectory, "MSI install directory");
    // Windows Installer parses GetCommandLineW, not just argv. An ordinary
    // Node spawn() escapes the quotes inside INSTALLDIR="...", so msiexec can
    // hang in a modal usage/error dialog even with /qn and no MSI log. These
    // arguments are already quoted for windowsVerbatimArguments below.
    return ["/i", msi, "/qn", "/norestart", `INSTALLDIR=${directory}`, "/L*V!", log];
  }
  if (action === "uninstall") return ["/x", msi, "/qn", "/norestart", "/L*V!", log];
  throw new Error(`unsupported MSI action: ${action}`);
}

function quoteMsiexecPath(value, label) {
  if (typeof value !== "string" || !value || /["\x00-\x1f]/u.test(value) || value.endsWith("\\")) {
    throw new Error(`${label} is invalid`);
  }
  return `"${value}"`;
}

export function checkMsiexecExitCode(exitCode, action, { allowNotInstalled = false } = {}) {
  if (exitCode === 0) return { rebootRequired: false, notInstalled: false };
  if (exitCode === 3010) return { rebootRequired: true, notInstalled: false };
  if (exitCode === 1641) throw new Error(`MSI ${action} initiated a system restart despite /norestart (exit code 1641)`);
  if (allowNotInstalled && exitCode === 1605) return { rebootRequired: false, notInstalled: true };
  throw new Error(`MSI ${action} failed with msiexec exit code ${exitCode}`);
}

export function buildMsiexecPreflightArguments(missingMsiPath, logPath) {
  // An intentionally nonexistent MSI cannot install anything. Exercise the
  // *same public property syntax* as the actual smoke, including a path with
  // spaces; a previous preflight without INSTALLDIR missed a modal CLI hang.
  return buildMsiexecArguments(
    "install", missingMsiPath, path.join(path.dirname(missingMsiPath), "install destination with spaces"), logPath,
  );
}

export function verifyMsiexecPreflightExitCode(exitCode) {
  if (exitCode !== 1619 && exitCode !== 1620) {
    throw new Error(`msiexec preflight failed to reject a missing MSI normally (exit ${exitCode}); installer smoke is unsafe to interpret`);
  }
}

export function verifyMsiexecPreflightLog(logPath) {
  const status = summarizeMsiLogTail(logPath);
  if (!status.exists || status.size === 0) {
    throw new Error("msiexec preflight returned, but Windows Installer did not write the requested verbose log");
  }
  return status.size;
}

export async function msiexecPreflight(smokeRoot, diagnosticDirectory, { command = "msiexec.exe", timeoutMs = MSI_PREFLIGHT_TIMEOUT_MS } = {}) {
  const missingMsi = path.join(smokeRoot, "definitely-missing-msiexec-preflight.msi");
  if (fs.existsSync(missingMsi)) throw new Error("MSI preflight sentinel must not exist");
  const preflightLog = path.join(diagnosticDirectory, "msi-preflight.log");
  const code = await runMsiexec(buildMsiexecPreflightArguments(missingMsi, preflightLog), "preflight", preflightLog, {
    command, timeoutMs,
    diagnosticPath: path.join(diagnosticDirectory, "msi-preflight-status.txt"),
    processDiagnosticPath: path.join(diagnosticDirectory, "msi-preflight-processes.txt"),
  });
  verifyMsiexecPreflightExitCode(code);
  verifyMsiexecPreflightLog(preflightLog);
  return code;
}

// Only fixed process/service names, numeric process IDs and booleans/status
// are collected. No command lines, executable paths, user names, MSI properties
// or verbose installer logs are persisted in CI diagnostics.
const MSI_PROCESS_PROBE_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$service = Get-Service -Name 'msiserver'
if ($service) { Write-Output "service=$($service.Status)" }
$names = @('msiexec.exe', 'consent.exe', 'msedgewebview2.exe', 'MicrosoftEdgeWebView2RuntimeInstallerX64.exe')
$processes = @(Get-CimInstance Win32_Process -Filter "Name='msiexec.exe' OR Name='consent.exe' OR Name='msedgewebview2.exe' OR Name='MicrosoftEdgeWebView2RuntimeInstallerX64.exe'")
foreach ($name in $names) {
  $matching = @($processes | Where-Object { $_.Name -ieq $name })
  Write-Output "$name=$($matching.Count)"
  foreach ($process in $matching | Select-Object -First 5) {
    Write-Output "pid=$($process.ProcessId) parent=$($process.ParentProcessId) name=$($process.Name)"
  }
}
`;

export function sanitizeMsiexecProcessEvidence(output) {
  return String(output).split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^(?:service=(?:Running|Stopped|StartPending|StopPending|Paused)|(?:msiexec\.exe|consent\.exe|msedgewebview2\.exe|MicrosoftEdgeWebView2RuntimeInstallerX64\.exe)=\d{1,4}|pid=\d{1,10} parent=\d{1,10} name=(?:msiexec\.exe|consent\.exe|msedgewebview2\.exe|MicrosoftEdgeWebView2RuntimeInstallerX64\.exe))$/iu.test(line))
    .slice(0, 32);
}

function probeMsiexecProcessState() {
  if (process.platform !== "win32") return Promise.resolve(["probe unavailable: non-Windows host"]);
  return new Promise((resolve) => {
    const command = Buffer.from(MSI_PROCESS_PROBE_PS, "utf16le").toString("base64");
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", command], {
      windowsHide: true, timeout: MSI_PROCESS_PROBE_TIMEOUT_MS, maxBuffer: 8192,
    }, (error, stdout) => resolve(error ? ["probe unavailable"] : sanitizeMsiexecProcessEvidence(stdout)));
  });
}

// Only action identities and numeric return codes are extracted from MSI logs.
// Never upload raw MSI verbose logs: they may contain MSI properties/secrets.
export function summarizeMsiLogTail(logPath) {
  let descriptor;
  try {
    descriptor = fs.openSync(logPath, "r");
    const size = fs.fstatSync(descriptor).size;
    const length = Math.min(size, MSI_LOG_TAIL_BYTES);
    const bytes = Buffer.alloc(length);
    fs.readSync(descriptor, bytes, 0, length, size - length);
    const actions = [];
    for (const line of bytes.toString("utf8").split(/\r?\n/u)) {
      const match = /^Action (start|ended) [^\r\n]{0,100}?: ([A-Za-z][A-Za-z0-9_.:-]{0,79})\.(?: Return value (\d+)\.)?\s*$/u.exec(line);
      if (match) actions.push(`${match[1]} ${match[2]}${match[3] ? ` (code ${match[3]})` : ""}`);
    }
    return { exists: true, size, recentActions: actions.slice(-8) };
  } catch {
    return { exists: false, size: 0, recentActions: [] };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function recordMsiDiagnostic(diagnosticPath, action, state, startTime, processId, logPath, extra = "") {
  if (!diagnosticPath) return;
  const snapshot = summarizeMsiLogTail(logPath);
  const lines = [
    `Action: ${action}`,
    `State: ${state}`,
    `Elapsed seconds: ${Math.floor((Date.now() - startTime) / 1000)}`,
    `Launcher PID: ${Number.isInteger(processId) ? processId : "unavailable"}`,
    `MSI verbose log readable: ${snapshot.exists}`,
    `MSI verbose log bytes: ${snapshot.size}`,
    ...snapshot.recentActions.map((value) => `MSI action: ${value}`),
    ...(extra ? [`Outcome: ${extra}`] : []),
  ];
  writeRegularFileSync(diagnosticPath, `${lines.join("\n")}\n`);
}

export function runMsiexec(args, action, logPath, {
  command = "msiexec.exe",
  timeoutMs = MSI_TIMEOUT_MS,
  pollMs = MSI_DIAGNOSTIC_POLL_MS,
  diagnosticPath,
  processDiagnosticPath,
  processProbe = probeMsiexecProcessState,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(pollMs) || pollMs <= 0) {
    throw new Error("invalid MSI watchdog settings");
  }
  // Windows Installer requires the log's parent to exist; verify it is a real
  // writable directory before spawning, instead of diagnosing a silent hang.
  const logDirectory = path.dirname(logPath);
  const directoryInfo = fs.lstatSync(logDirectory);
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) throw new Error("MSI log directory is unsafe");
  const probe = fs.openSync(logPath, "a");
  fs.closeSync(probe);

  return new Promise((resolve, reject) => {
    const started = Date.now();
    // With a real msiexec.exe on Windows, let the Windows Installer parser
    // receive the exact CLI tokens built above. Tests using a substitute Node
    // executable intentionally retain normal spawn argv handling.
    const isWindowsInstaller = process.platform === "win32" && path.basename(command).toLowerCase() === "msiexec.exe";
    const child = spawn(command, args, { stdio: "ignore", windowsHide: true, windowsVerbatimArguments: isWindowsInstaller });
    let settled = false;
    let timedOut = false;
    let timer;
    let interval;
    let lastProbeAt = -MSI_PROCESS_PROBE_INTERVAL_MS;
    let probePending = false;
    const processSnapshots = [];
    const captureProcesses = () => {
      if (!processDiagnosticPath || probePending || settled || Date.now() - lastProbeAt < MSI_PROCESS_PROBE_INTERVAL_MS) return;
      lastProbeAt = Date.now();
      probePending = true;
      Promise.resolve().then(() => processProbe()).then((evidence) => {
        if (!Array.isArray(evidence)) return;
        const snapshotLines = sanitizeMsiexecProcessEvidence(evidence.join("\n"));
        processSnapshots.push(`Elapsed seconds: ${Math.floor((Date.now() - started) / 1000)}`, ...snapshotLines);
        if (processSnapshots.length > 128) processSnapshots.splice(0, processSnapshots.length - 128);
        writeRegularFileSync(processDiagnosticPath, `${processSnapshots.join("\n")}\n`);
      }).catch(() => { /* Installer itself must determine smoke success. */ })
        .finally(() => { probePending = false; });
    };
    const snapshot = (state, extra = "") => {
      try { recordMsiDiagnostic(diagnosticPath, action, state, started, child.pid, logPath, extra); }
      catch (error) { console.error(`MSI diagnostics unavailable: ${error.message}`); }
      if (state === "started" || state === "running") captureProcesses();
    };
    const settle = (error, code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(interval);
      snapshot(error ? "failed" : "exited", error ? error.message : `exit ${code}`);
      if (error) reject(error);
      else resolve(code);
    };
    child.once("error", (error) => settle(error));
    child.once("close", (code, signal) => {
      if (timedOut) return;
      if (code === null) settle(new Error(`MSI ${action} terminated by signal ${signal ?? "unknown"}`));
      else settle(undefined, code);
    });
    snapshot("started");
    interval = setInterval(() => snapshot("running"), pollMs);
    timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      // Killing the launcher does not prove that the msiserver transaction
      // stopped; never attempt uninstall after an install timeout.
      child.kill();
      const timeoutError = new Error(`MSI ${action} timed out after ${timeoutMs / 1_000} seconds`);
      timeoutError.name = "MsiexecTimeoutError";
      timeoutError.action = action;
      timeoutError.logPath = logPath;
      settle(timeoutError);
    }, timeoutMs);
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : "Package verification failed.";
}

function appendCleanupError(currentError, phase, cleanupError) {
  const message = `${phase} failed: ${errorMessage(cleanupError)}`;
  return currentError
    ? new Error(`${errorMessage(currentError)}; ${message}`, { cause: currentError })
    : new Error(message, { cause: cleanupError });
}

async function msiSmoke(artifactDirectory, metadata, smokeRoot, diagnosticDirectory, lines) {
  const installer = windowsInstallerPath(artifactDirectory, metadata.version, "msi");
  const installDirectory = path.join(smokeRoot, "msi-installed");
  const installLogPath = path.join(diagnosticDirectory, "msi-install.log");
  const uninstallLogPath = path.join(diagnosticDirectory, "msi-uninstall.log");
  const expectedExecutable = path.join(installDirectory, `${metadata.mainBinaryName}.exe`);
  let executable = expectedExecutable;
  let installedWorker;
  let installAttempted = false;
  let installTimedOut = false;
  let smokeError;

  // Test the Windows Installer launcher BEFORE executing a valid MSI. If the
  // runner cannot reject an impossible package promptly, that is a host/CLI
  // issue rather than evidence that WebView2 or the actual payload hung.
  const preflightCode = await msiexecPreflight(smokeRoot, diagnosticDirectory);
  lines.push(`Windows Installer preflight: missing package rejected (exit ${preflightCode}).`);

  try {
    installAttempted = true;
    const installCode = await runMsiexec(buildMsiexecArguments("install", installer, installDirectory, installLogPath), "install", installLogPath, {
      diagnosticPath: path.join(diagnosticDirectory, "msi-install-status.txt"),
      processDiagnosticPath: path.join(diagnosticDirectory, "msi-install-processes.txt"),
    });
    const installResult = checkMsiexecExitCode(installCode, "install");
    if (installResult.rebootRequired) throw new Error("MSI installation requested a reboot; this clean-install smoke cannot validate a pre-reboot application launch");
    lines.push(`MSI clean install: passed (msiexec exit code ${installCode}${installResult.rebootRequired ? "; restart required, /norestart requested" : ""}).`);
    executable = findInstalledExecutable(installDirectory, metadata.productName, metadata.mainBinaryName);
    lines.push(`MSI installed executable: found (${path.basename(executable)}).`);
    installedWorker = verifyInstalledWorker(path.dirname(executable));
    lines.push("MSI installed worker: sidecar present, matches the SHA-256 of the built app-owned executable.");
    await launchAndStop(executable, []);
    lines.push("MSI installed executable start: passed.");
    await launchAndStop(executable, []);
    lines.push("MSI installed executable restart: passed.");
  } catch (error) {
    smokeError = error;
    if (error instanceof Error && error.name === "MsiexecTimeoutError" && error.action === "install") {
      installTimedOut = true;
      lines.push(`MSI install verbose log: ${error.logPath}`);
    }
  } finally {
    if (installAttempted && installTimedOut) {
      lines.push("MSI teardown: skipped because the install timed out and Windows Installer state is unresolved; the clean runner will be discarded.");
    } else if (installAttempted) {
      try {
        const uninstallCode = await runMsiexec(buildMsiexecArguments("uninstall", installer, undefined, uninstallLogPath), "uninstall", uninstallLogPath, {
          diagnosticPath: path.join(diagnosticDirectory, "msi-uninstall-status.txt"),
          processDiagnosticPath: path.join(diagnosticDirectory, "msi-uninstall-processes.txt"),
        });
        const uninstallResult = checkMsiexecExitCode(uninstallCode, "uninstall", { allowNotInstalled: true });
        if (uninstallResult.rebootRequired) throw new Error("MSI uninstall requested a reboot; clean teardown was not verified");
        if (uninstallResult.notInstalled) {
          if (fs.existsSync(expectedExecutable)) throw new Error("MSI product was not registered for uninstall but its executable remains");
          if (installedWorker && fs.existsSync(installedWorker)) throw new Error("MSI product was not registered for uninstall but its worker sidecar remains");
          lines.push("MSI teardown: no registered product remained (msiexec exit code 1605).");
        } else {
          if (!(await waitForPathToDisappear(executable))) throw new Error("MSI uninstall left the installed executable behind after the removal wait");
          if (installedWorker && !(await waitForPathToDisappear(installedWorker))) throw new Error("MSI uninstall left the app-owned worker sidecar behind after the removal wait");
          lines.push(`MSI silent uninstall: passed (msiexec exit code ${uninstallCode}${uninstallResult.rebootRequired ? "; restart required, /norestart requested" : ""}).`);
        }
      } catch (error) {
        if (error instanceof Error && error.name === "MsiexecTimeoutError") lines.push(`MSI uninstall verbose log: ${error.logPath}`);
        smokeError = appendCleanupError(smokeError, "MSI teardown", error);
      }
    }
  }
  if (smokeError) throw smokeError;
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
    lines.push("MSI clean-install smoke: skipped (the current runner is not Windows).");
    return;
  }
  const installer = windowsInstallerPath(artifactDirectory, metadata.version, "nsis");
  const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-arena-p7-windows-"));
  const installDirectory = path.join(smokeRoot, "installed");
  try {
    const configuredDiagnosticsDirectory = process.env.PACKAGE_DIAGNOSTICS_DIR?.trim();
    const diagnosticDirectory = configuredDiagnosticsDirectory
      ? path.resolve(configuredDiagnosticsDirectory)
      : path.join(smokeRoot, "diagnostics");
    fs.mkdirSync(diagnosticDirectory, { recursive: true });
    await msiSmoke(artifactDirectory, metadata, smokeRoot, diagnosticDirectory, lines);
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
  writeRegularFileSync(evidencePath, `${lines.join("\n")}\n`);
}

function parseCliArgs(argv) {
  const options = { smoke: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--smoke" || argument === "--install") {
      options.smoke = true;
      continue;
    }
    if (argument === "--msiexec-preflight-only") {
      options.msiexecpreflightonly = true;
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
    if (options.msiexecpreflightonly) {
      if (process.platform !== "win32") throw new Error("Windows Installer preflight requires a Windows host");
      if (options.smoke || options.platform || options.artifactdirectory || options.manifestpath || options.evidencefile) {
        throw new Error("Windows Installer preflight must run without package verification options");
      }
      const smokeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-arena-msiexec-preflight-"));
      const diagnosticDirectory = process.env.PACKAGE_DIAGNOSTICS_DIR?.trim()
        ? path.resolve(process.env.PACKAGE_DIAGNOSTICS_DIR.trim()) : path.join(smokeRoot, "diagnostics");
      fs.mkdirSync(diagnosticDirectory, { recursive: true });
      const code = await msiexecPreflight(smokeRoot, diagnosticDirectory);
      console.log(`Windows Installer launcher preflight passed (missing MSI rejected with exit ${code}).`);
    } else {
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
    }
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
