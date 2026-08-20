import assert from "node:assert/strict";
import {
  checkIgnoreText,
  checkTauriConfig,
  checkWorkflowText,
  findObviousKeyMaterial,
  findSecretLikePaths,
} from "./boundary-check.mjs";

const CSP = "default-src 'self'; connect-src 'self' http://localhost:1420 ws://localhost:1420 ipc: http://ipc.localhost; style-src 'self'; font-src 'self'; script-src 'self'";

function test(name, callback) {
  callback();
  console.log(`Boundary fixture passed: ${name}`);
}

test("accepts the reviewed Windows/Linux workflow and local Tauri boundary", () => {
  const workflow = `
    # macOS is documentation-only and must not become a runner.
    on:
      pull_request:
    jobs:
      checks:
        strategy:
          matrix:
            os: [windows-latest, ubuntu-latest]
        runs-on: \${{ matrix.os }}
        steps:
          - run: npm install --no-audit --no-fund
          - run: npm run check:boundaries
          - run: npm audit --omit=dev --audit-level=high
  `;
  assert.deepEqual(checkWorkflowText(workflow), []);
  assert.deepEqual(checkTauriConfig({
    app: { security: { csp: CSP } },
    bundle: { active: false, targets: ["nsis", "deb", "appimage"] },
  }), []);
});

test("rejects active macOS CI and packaging drift", () => {
  const workflowFailures = checkWorkflowText("on: { pull_request: {} }\njobs:\n  x:\n    runs-on: macos-latest\n");
  assert.ok(workflowFailures.some((failure) => failure.includes("macOS")));
  const configFailures = checkTauriConfig({
    app: { security: { csp: CSP } },
    bundle: { active: true, targets: ["dmg"] },
  });
  assert.ok(configFailures.some((failure) => failure.includes("macOS")));
});

test("requires secret ignore rules and reports paths without file contents", () => {
  const ignore = [
    ".env", ".env.*", "!.env.example", "*.local", "*.pem", "*.key", "*.p12", "*.pfx", "*.jks",
    "*.keystore", "*.secret", "*.secrets", "*.token", "credentials*.json", ".npmrc", "secrets/",
  ].join("\n");
  assert.deepEqual(checkIgnoreText(ignore), []);
  assert.deepEqual(findSecretLikePaths([".env.example", "keys/private.pem", "docs/notes.md"]), ["keys/private.pem"]);
});

test("detects generated obvious key material without returning its value", () => {
  const generatedKey = ["sk-", "A".repeat(24)].join("");
  const hits = findObviousKeyMaterial([
    ["docs/example.md", "No credential here."],
    ["local.txt", generatedKey],
  ]);
  assert.deepEqual(hits, ["local.txt"]);
  assert.equal(hits.join("\n").includes(generatedKey), false);
});
