import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { readRegularFileSync, writeRegularFileSync } from "./safe-files.mjs";

const temporaryRoots = [];

afterEach(() => {
  while (temporaryRoots.length > 0) fs.rmSync(temporaryRoots.pop(), { recursive: true, force: true });
});

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-arena-safe-files-test-"));
  temporaryRoots.push(root);
  return root;
}

function tryCreateSymlink(target, linkPath) {
  try {
    fs.symlinkSync(target, linkPath);
    return true;
  } catch (error) {
    if (process.platform === "win32" && ["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return false;
    throw error;
  }
}

describe("regular-file helpers", () => {
  it("reads a regular file through the opened file descriptor", () => {
    const root = temporaryRoot();
    const input = path.join(root, "input.txt");
    fs.writeFileSync(input, "verified");
    expect(readRegularFileSync(input, "utf8")).toBe("verified");
  });

  it("rejects a symlink read without following it", () => {
    const root = temporaryRoot();
    const target = path.join(root, "target.txt");
    const link = path.join(root, "input.txt");
    fs.writeFileSync(target, "private target");
    if (!tryCreateSymlink(target, link)) return;
    expect(() => readRegularFileSync(link, "utf8")).toThrow();
  });

  it("creates an output and safely rewrites a regular file", () => {
    const root = temporaryRoot();
    const output = path.join(root, "evidence.txt");
    writeRegularFileSync(output, "first");
    writeRegularFileSync(output, "second");
    expect(readRegularFileSync(output, "utf8")).toBe("second");
  });

  it("creates an exclusive output only once", () => {
    const root = temporaryRoot();
    const output = path.join(root, "checksum.txt");
    writeRegularFileSync(output, "first", { exclusive: true });
    expect(() => writeRegularFileSync(output, "second", { exclusive: true })).toThrow();
    expect(readRegularFileSync(output, "utf8")).toBe("first");
  });

  it("rejects a symlink output without changing its target", () => {
    const root = temporaryRoot();
    const target = path.join(root, "target.txt");
    const link = path.join(root, "evidence.txt");
    fs.writeFileSync(target, "original");
    if (!tryCreateSymlink(target, link)) return;
    expect(() => writeRegularFileSync(link, "attacker-controlled")).toThrow();
    expect(fs.readFileSync(target, "utf8")).toBe("original");
  });
});
