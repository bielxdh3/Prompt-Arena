import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  packageArtifactName,
  preparePackageArtifacts,
  renderChecksumManifest,
  sha256File,
  verifyChecksumManifest,
} from "./package-artifacts.mjs";
import { workerArtifactPath, workerSidecarName, workerSidecarPath } from "./prepare-worker-sidecar.mjs";

const temporaryRoots = [];

afterEach(() => {
  while (temporaryRoots.length > 0) fs.rmSync(temporaryRoots.pop(), { recursive: true, force: true });
});

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-arena-package-test-"));
  temporaryRoots.push(root);
  return root;
}

describe("desktop packaging helpers", () => {
  it("keeps worker artifacts target-specific and deterministic", () => {
    const repositoryRoot = temporaryRoot();
    expect(workerSidecarName("x86_64-pc-windows-msvc")).toBe("prompt-arena-worker-x86_64-pc-windows-msvc.exe");
    expect(workerSidecarName("x86_64-unknown-linux-gnu")).toBe("prompt-arena-worker-x86_64-unknown-linux-gnu");
    expect(workerArtifactPath(repositoryRoot, "x86_64-pc-windows-msvc")).toBe(
      path.join(repositoryRoot, "src-tauri", "target", "x86_64-pc-windows-msvc", "release", "prompt-arena-worker.exe"),
    );
    expect(workerSidecarPath(repositoryRoot, "x86_64-unknown-linux-gnu")).toBe(
      path.join(repositoryRoot, "src-tauri", "binaries", "prompt-arena-worker-x86_64-unknown-linux-gnu"),
    );
  });

  it("normalizes the required package names and Windows MSI name", () => {
    expect(packageArtifactName("windows", "0.1.0", "nsis")).toBe("prompt-arena-0.1.0-windows-nsis.exe");
    expect(packageArtifactName("windows", "0.1.0", "msi")).toBe("Prompt-Arena-0.1.0-windows-x64.msi");
    expect(packageArtifactName("linux", "0.1.0", "deb")).toBe("prompt-arena-0.1.0-linux-deb.deb");
    expect(packageArtifactName("linux", "0.1.0", "appimage")).toBe("prompt-arena-0.1.0-linux-appimage.AppImage");
  });

  it("copies target bundles and writes a sorted SHA-256 manifest", () => {
    const repositoryRoot = temporaryRoot();
    const bundleRoot = path.join(repositoryRoot, "bundle");
    const nsisDirectory = path.join(bundleRoot, "nsis");
    const msiDirectory = path.join(bundleRoot, "msi");
    const outputDirectory = path.join(repositoryRoot, "package-artifacts");
    fs.mkdirSync(nsisDirectory, { recursive: true });
    fs.mkdirSync(msiDirectory, { recursive: true });
    fs.writeFileSync(path.join(nsisDirectory, "Prompt Arena_0.1.0_x64-setup.exe"), "nsis");
    fs.writeFileSync(path.join(msiDirectory, "Prompt Arena_0.1.0_x64_en-US.msi"), "msi");

    const result = preparePackageArtifacts({
      repositoryRoot,
      platform: "windows",
      version: "0.1.0",
      bundleRoot,
      outputDirectory,
      manifestPath: path.join(repositoryRoot, "checksums-sha256.txt"),
    });

    expect(result.missingOptional).toEqual([]);
    expect(result.artifacts.map(({ name }) => name)).toEqual([
      "Prompt-Arena-0.1.0-windows-x64.msi",
      "prompt-arena-0.1.0-windows-nsis.exe",
    ]);
    expect(verifyChecksumManifest(result.manifestPath, outputDirectory)).toEqual(
      result.artifacts.map(({ name, sha256 }) => ({ name, sha256 })),
    );
  });

  it("fails closed when the mandatory Windows MSI is absent", () => {
    const repositoryRoot = temporaryRoot();
    const bundleRoot = path.join(repositoryRoot, "bundle");
    const nsisDirectory = path.join(bundleRoot, "nsis");
    fs.mkdirSync(nsisDirectory, { recursive: true });
    fs.writeFileSync(path.join(nsisDirectory, "Prompt Arena_0.1.0_x64-setup.exe"), "nsis");

    expect(() => preparePackageArtifacts({ repositoryRoot, platform: "windows", version: "0.1.0", bundleRoot })).toThrow(
      "required msi bundle artifact was not produced",
    );
  });

  it("renders deterministic checksums and rejects changed artifact bytes", () => {
    const root = temporaryRoot();
    const first = path.join(root, "first.bin");
    const second = path.join(root, "second.bin");
    fs.writeFileSync(first, "first");
    fs.writeFileSync(second, "second");
    const manifest = renderChecksumManifest([
      { name: "second.bin", sha256: sha256File(second) },
      { name: "first.bin", sha256: sha256File(first) },
    ]);
    expect(manifest).toBe(`${sha256File(first)}  first.bin\n${sha256File(second)}  second.bin\n`);
    const manifestPath = path.join(root, "checksums-sha256.txt");
    fs.writeFileSync(manifestPath, manifest);
    expect(verifyChecksumManifest(manifestPath, root)).toHaveLength(2);
    fs.writeFileSync(second, "changed");
    expect(() => verifyChecksumManifest(manifestPath, root)).toThrow("checksum mismatch for second.bin");
  });
});
