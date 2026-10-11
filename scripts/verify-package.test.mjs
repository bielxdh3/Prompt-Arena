import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildMsiexecArguments,
  buildMsiexecPreflightArguments,
  checkMsiexecExitCode,
  runMsiexec,
  sanitizeMsiexecProcessEvidence,
  summarizeMsiLogTail,
  verifyMsiexecPreflightExitCode,
  verifyMsiexecPreflightLog,
  verifyInstalledWorker,
  windowsInstallerPath,
} from "./verify-package.mjs";

const smokeRoots = [];
afterEach(() => {
  for (const root of smokeRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function diagnosticRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-arena-msiexec-unit-"));
  smokeRoots.push(root);
  return root;
}

describe("Windows package smoke helpers", () => {
  it("selects the normalized MSI and NSIS artifacts by kind", () => {
    const artifactDirectory = path.join("C:", "runner temp", "package-artifacts");
    expect(windowsInstallerPath(artifactDirectory, "0.1.4", "msi")).toBe(
      path.join(artifactDirectory, "Prompt-Arena-0.1.4-windows-x64.msi"),
    );
    expect(windowsInstallerPath(artifactDirectory, "0.1.4", "nsis")).toBe(
      path.join(artifactDirectory, "prompt-arena-0.1.4-windows-nsis.exe"),
    );
  });

  it("uses quiet, no-restart MSI install and uninstall commands with verbose logs", () => {
    const installer = path.join("C:", "runner temp", "Prompt-Arena.msi");
    const installDirectory = path.join("C:", "runner temp", "Prompt Arena MSI");
    const installLog = path.join("C:", "runner temp", "msi install.log");
    const uninstallLog = path.join("C:", "runner temp", "msi uninstall.log");
    expect(buildMsiexecArguments("install", installer, installDirectory, installLog)).toEqual([
      "/i",
      `"${installer}"`,
      "/qn",
      "/norestart",
      `INSTALLDIR="${installDirectory}"`,
      "/L*V!",
      `"${installLog}"`,
    ]);
    expect(buildMsiexecArguments("uninstall", installer, undefined, uninstallLog)).toEqual([
      "/x",
      `"${installer}"`,
      "/qn",
      "/norestart",
      "/L*V!",
      `"${uninstallLog}"`,
    ]);
    expect(() => buildMsiexecArguments("install", installer, "C:\\bad\"path", installLog)).toThrow("MSI install directory is invalid");
    expect(() => buildMsiexecArguments("install", installer, installDirectory)).toThrow("MSI log path is invalid");
    expect(() => buildMsiexecArguments("uninstall", installer, undefined, "C:\\bad\"log")).toThrow("MSI log path is invalid");
    expect(() => buildMsiexecArguments("repair", installer, undefined, uninstallLog)).toThrow("unsupported MSI action");
  });

  it("classifies standard MSI success and teardown codes without accepting a reboot request", () => {
    expect(checkMsiexecExitCode(0, "install")).toEqual({ rebootRequired: false, notInstalled: false });
    expect(checkMsiexecExitCode(3010, "install")).toEqual({ rebootRequired: true, notInstalled: false });
    expect(checkMsiexecExitCode(1605, "uninstall", { allowNotInstalled: true })).toEqual({
      rebootRequired: false,
      notInstalled: true,
    });
    expect(() => checkMsiexecExitCode(1641, "install")).toThrow("initiated a system restart despite /norestart");
    expect(() => checkMsiexecExitCode(1605, "install")).toThrow("exit code 1605");
    expect(() => checkMsiexecExitCode(1605, "uninstall")).toThrow("exit code 1605");
    expect(() => checkMsiexecExitCode(1603, "install")).toThrow("exit code 1603");
  });

  it("preflights a nonexistent MSI with quiet arguments without installing a real package", () => {
    const root = diagnosticRoot();
    const missingMsi = path.join(root, "missing.msi");
    const log = path.join(root, "preflight.log");
    expect(fs.existsSync(missingMsi)).toBe(false);
    expect(buildMsiexecPreflightArguments(missingMsi, log)).toEqual([
      "/i", `"${missingMsi}"`, "/qn", "/norestart",
      `INSTALLDIR="${path.join(root, "install destination with spaces")}"`, "/L*V!", `"${log}"`,
    ]);
    for (const code of [1619, 1620]) expect(() => verifyMsiexecPreflightExitCode(code)).not.toThrow();
    for (const code of [0, 1603, 3010]) expect(() => verifyMsiexecPreflightExitCode(code)).toThrow("preflight failed");
    expect(() => verifyMsiexecPreflightLog(log)).toThrow("did not write the requested verbose log");
    fs.writeFileSync(log, "");
    expect(() => verifyMsiexecPreflightLog(log)).toThrow("did not write the requested verbose log");
    fs.writeFileSync(log, "MSI (s) (00:00): preflight diagnostic bytes");
    expect(verifyMsiexecPreflightLog(log)).toBeGreaterThan(0);
  });

  it("keeps substitute process argv intact, without applying msiexec-specific verbatim quoting", async () => {
    const root = diagnosticRoot();
    const log = path.join(root, "msi.log");
    const output = path.join(root, "argv capture.json");
    const value = 'INSTALLDIR=C:\\Program Files\\Prompt Arena';
    const script = "require('node:fs').writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))";
    expect(await runMsiexec(["-e", script, output, value], "install", log, {
      command: process.execPath, timeoutMs: 3_000, pollMs: 200,
    })).toBe(0);
    expect(JSON.parse(fs.readFileSync(output, "utf8"))).toEqual([value]);
  });

  it.skipIf(process.platform !== "win32")("passes explicitly quoted INSTALLDIR values to real Windows Installer without a modal parser hang", async () => {
    // A nonexistent MSI cannot install anything. It still exercises the exact
    // /qn + INSTALLDIR + /L*V! command line that hung for 600 s in CI.
    const root = diagnosticRoot();
    const nonexistent = path.join(root, "nonexistent package.msi");
    const directory = path.join(root, "destination with spaces");
    const log = path.join(root, "msi cli test.log");
    const status = path.join(root, "cli-status.txt");
    expect(fs.existsSync(nonexistent)).toBe(false);
    const args = buildMsiexecArguments("install", nonexistent, directory, log);
    const code = await runMsiexec(args, "install", log, { timeoutMs: 6_000, pollMs: 500, diagnosticPath: status });
    expect(code).toBe(1619);
    expect(summarizeMsiLogTail(log).size).toBeGreaterThan(0);
    expect(fs.readFileSync(status, "utf8")).toContain("State: exited");
  });

  it("filters installer process snapshots to names and numeric IDs, never command lines", () => {
    const evidence = [
      "service=Running",
      "msiexec.exe=1",
      "pid=596 parent=210 name=msiexec.exe",
      "MicrosoftEdgeWebView2RuntimeInstallerX64.exe=0",
      "pid=999 parent=1 name=bad-process.exe",
      "CommandLine=TOKEN=sensitive-secret",
      "someuser=example",
    ].join("\n");
    expect(sanitizeMsiexecProcessEvidence(evidence)).toEqual([
      "service=Running", "msiexec.exe=1", "pid=596 parent=210 name=msiexec.exe",
      "MicrosoftEdgeWebView2RuntimeInstallerX64.exe=0",
    ]);
  });

  it("extracts only safe MSI action names and numeric codes from verbose logs", () => {
    const file = path.join(diagnosticRoot(), "msi.log");
    fs.writeFileSync(file, [
      "Property(S): PASSWORD = secret-would-leak",
      "Action start 9:43:05: InstallValidate.",
      "Action ended 9:43:06: InstallValidate. Return value 1.",
      "Action start 9:43:07: CUSTOM_ACTION_password=secret.",
      "Action ended 9:43:08: InstallFinalize. Return value 3.",
    ].join("\n"));
    expect(summarizeMsiLogTail(file)).toEqual({
      exists: true,
      size: fs.statSync(file).size,
      recentActions: ["start InstallValidate", "ended InstallValidate (code 1)", "ended InstallFinalize (code 3)"],
    });
  });

  it("records an actionable process heartbeat and short timeout without exposing argv", async () => {
    const root = diagnosticRoot();
    const log = path.join(root, "msi.log");
    const status = path.join(root, "msi-status.txt");
    await expect(runMsiexec(["-e", "setTimeout(() => {}, 10000)"], "install", log, {
      command: process.execPath,
      timeoutMs: 200,
      pollMs: 40,
      diagnosticPath: status,
    })).rejects.toMatchObject({ name: "MsiexecTimeoutError", action: "install" });
    const contents = fs.readFileSync(status, "utf8");
    expect(contents).toContain("State: failed");
    expect(contents).toContain("MSI verbose log bytes: 0");
    expect(contents).toContain("MSI install timed out after 0.2 seconds");
    expect(contents).not.toContain("setTimeout(() => {}, 10000)");
  });

  it("persists allowlisted process evidence while launcher stalls, omitting secrets", async () => {
    const root = diagnosticRoot();
    const log = path.join(root, "msi.log");
    const processStatus = path.join(root, "msi-processes.txt");
    await expect(runMsiexec(["-e", "setTimeout(() => {}, 10000)"], "install", log, {
      command: process.execPath,
      timeoutMs: 300,
      pollMs: 50,
      diagnosticPath: path.join(root, "msi-status.txt"),
      processDiagnosticPath: processStatus,
      processProbe: async () => ["service=Stopped", "msiexec.exe=1", "pid=99 parent=11 name=msiexec.exe", "TOKEN=secret"],
    })).rejects.toMatchObject({ name: "MsiexecTimeoutError" });
    const report = fs.readFileSync(processStatus, "utf8");
    expect(report).toContain("msiexec.exe=1");
    expect(report).toContain("service=Stopped");
    expect(report).not.toContain("TOKEN=secret");
  });

  it("tracks a zero-exit launcher and saves final diagnostic status", async () => {
    const root = diagnosticRoot();
    const status = path.join(root, "msi-status.txt");
    expect(await runMsiexec(["-e", "process.exit(0)"], "install", path.join(root, "msi.log"), {
      command: process.execPath,
      timeoutMs: 3_000,
      pollMs: 50,
      diagnosticPath: status,
    })).toBe(0);
    expect(fs.readFileSync(status, "utf8")).toContain("State: exited");
  });

  it("refuses installed MSI workers missing or differing from the built app sidecar", () => {
    const root = diagnosticRoot();
    const install = path.join(root, "installed");
    const binaryDirectory = path.join(root, "src-tauri", "binaries");
    fs.mkdirSync(install, { recursive: true });
    fs.mkdirSync(binaryDirectory, { recursive: true });
    const built = path.join(binaryDirectory, "prompt-arena-worker-x86_64-pc-windows-msvc.exe");
    const installed = path.join(install, "prompt-arena-worker.exe");
    fs.writeFileSync(built, "legitimate-worker");
    expect(() => verifyInstalledWorker(install, root)).toThrow("exactly one Tauri-resolvable");
    fs.writeFileSync(installed, "wrong-worker");
    expect(() => verifyInstalledWorker(install, root)).toThrow("content differs");
    fs.copyFileSync(built, installed);
    expect(verifyInstalledWorker(install, root)).toBe(installed);
    const resourceWorker = path.join(install, "binaries", "prompt-arena-worker-x86_64-pc-windows-msvc.exe");
    fs.mkdirSync(path.dirname(resourceWorker));
    fs.copyFileSync(built, resourceWorker);
    expect(() => verifyInstalledWorker(install, root)).toThrow("exactly one Tauri-resolvable");
    fs.unlinkSync(installed);
    expect(verifyInstalledWorker(install, root)).toBe(resourceWorker);
    fs.writeFileSync(resourceWorker, "modified-content");
    expect(() => verifyInstalledWorker(install, root)).toThrow("content differs");
  });
});
