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
});
