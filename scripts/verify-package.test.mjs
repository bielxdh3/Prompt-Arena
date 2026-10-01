import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildMsiexecArguments,
  checkMsiexecExitCode,
  windowsInstallerPath,
} from "./verify-package.mjs";

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
      installer,
      "/qn",
      "/norestart",
      `INSTALLDIR="${installDirectory}"`,
      "/L*V!",
      installLog,
    ]);
    expect(buildMsiexecArguments("uninstall", installer, undefined, uninstallLog)).toEqual([
      "/x",
      installer,
      "/qn",
      "/norestart",
      "/L*V!",
      uninstallLog,
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
});
