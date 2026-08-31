import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { assertSynchronizedVersion, incrementPatchVersion, readVersionContract, writeSynchronizedVersion } from "./version-contract.mjs";

const temporaryRoots = [];

afterEach(() => {
  while (temporaryRoots.length > 0) fs.rmSync(temporaryRoots.pop(), { recursive: true, force: true });
});

describe("package version contract", () => {
  it("keeps all package metadata synchronized", () => {
    const version = assertSynchronizedVersion();
    expect(readVersionContract()).toEqual({
      packageJson: version,
      packageLock: version,
      packageLockRoot: version,
      tauri: version,
      cargoToml: version,
      cargoLock: version,
    });
  });

  it("increments only the patch component", () => {
    expect(incrementPatchVersion("0.1.0")).toBe("0.1.1");
    expect(incrementPatchVersion("2.4.9")).toBe("2.4.10");
  });

  it("writes every package metadata version together", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-arena-version-test-"));
    temporaryRoots.push(root);
    fs.mkdirSync(path.join(root, "src-tauri"));
    for (const relativePath of ["package.json", "package-lock.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"]) {
      const target = path.join(root, relativePath);
      fs.copyFileSync(path.join(process.cwd(), relativePath), target);
    }
    writeSynchronizedVersion("0.1.1", root);
    expect(assertSynchronizedVersion(root)).toBe("0.1.1");
  });
});
