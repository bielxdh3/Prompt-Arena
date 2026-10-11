import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("release publication boundary", () => {
  it("does not expose the local Windows release helper that committed and pushed the checked-out branch", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(REPOSITORY_ROOT, "package.json"), "utf8"));
    expect(manifest.scripts).not.toHaveProperty("release:windows");
    expect(fs.existsSync(path.join(REPOSITORY_ROOT, "scripts", "release-windows.mjs"))).toBe(false);
  });

  it("keeps the checked-in release workflow read-only and candidate-only", () => {
    const workflow = fs.readFileSync(path.join(REPOSITORY_ROOT, ".github", "workflows", "release.yml"), "utf8");
    expect(workflow).toContain("# This workflow only validates and packages candidates.");
    expect(workflow).toMatch(/^\s*contents:\s*read\s*$/m);
    expect(workflow).not.toMatch(/^\s*contents:\s*write\s*$/m);
    expect(workflow).not.toMatch(/\bgh\s+release\s+(?:create|edit|upload)\b/iu);
    expect(workflow).not.toMatch(/\bgit\s+push\b/iu);
  });

  it("keeps the reusable manual packaging workflow artifact-only", () => {
    const workflow = fs.readFileSync(path.join(REPOSITORY_ROOT, ".github", "workflows", "package.yml"), "utf8");
    expect(workflow).toMatch(/^\s*contents:\s*read\s*$/m);
    expect(workflow).not.toMatch(/^\s*contents:\s*write\s*$/m);
    expect(workflow).toContain("actions/upload-artifact@");
    expect(workflow).not.toMatch(/\bgh\s+release\s+(?:create|edit|upload)\b/iu);
    expect(workflow).not.toMatch(/\bgit\s+push\b/iu);
  });

  it("keeps Windows smoke text diagnostics on PRs and restricts failed installers to trusted manual runs", () => {
    const workflow = fs.readFileSync(path.join(REPOSITORY_ROOT, ".github", "workflows", "package.yml"), "utf8");
    const capture = workflow.indexOf("- name: Capture Windows Installer failure context");
    const uploadDiagnostics = workflow.indexOf("- name: Upload Windows MSI smoke diagnostics");
    const uploadFailedPackages = workflow.indexOf("- name: Upload failed Windows package candidates for reproduction");
    expect(capture).toBeGreaterThan(workflow.indexOf("- name: Verify Windows packages and run clean-install smoke"));
    expect(uploadDiagnostics).toBeGreaterThan(capture);
    expect(uploadFailedPackages).toBeGreaterThan(uploadDiagnostics);
    const captureStep = workflow.slice(capture, uploadDiagnostics);
    expect(captureStep).toContain("if: failure() && runner.os == 'Windows'");
    expect(captureStep).toContain("windows-installer-context.txt");
    expect(captureStep).toContain("Get-Service -Name msiserver");
    expect(captureStep).toContain("Get-CimInstance Win32_Process");
    expect(captureStep).toContain("Get-WinEvent");
    expect(captureStep).not.toMatch(/Select-Object[^\r\n]*(?:CommandLine|Message)/u);
    const diagnosticsStep = workflow.slice(uploadDiagnostics, uploadFailedPackages);
    expect(diagnosticsStep).toContain("if: failure() && runner.os == 'Windows'");
    expect(diagnosticsStep).not.toContain("github.event_name == 'workflow_dispatch'");
    expect(diagnosticsStep).toContain("prompt-arena-msi-diagnostics/");
    const failedPackageStep = workflow.slice(uploadFailedPackages, workflow.indexOf("- name: Verify Linux packages"));
    expect(failedPackageStep).toContain("if: failure() && runner.os == 'Windows' && github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.ref == 'main'");
    expect(failedPackageStep).toContain("package-artifacts/");
    expect(failedPackageStep).toContain("checksums-sha256.txt");
    expect(failedPackageStep).toContain("retention-days: 7");
  });
});
