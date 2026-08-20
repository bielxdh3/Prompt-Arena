import assert from "node:assert/strict";
import {
  checkCapabilityDocuments,
  checkIgnoreText,
  checkTauriConfig,
  checkWorkflowText,
  findObviousKeyMaterial,
  findSecretLikePaths,
} from "./boundary-check.mjs";

const CSP = "default-src 'self'; connect-src 'self' http://localhost:1420 ws://localhost:1420 ipc: http://ipc.localhost; img-src 'self' asset: https://asset.localhost data:; style-src 'self'; font-src 'self'; script-src 'self'";

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
  assert.deepEqual(checkCapabilityDocuments([
    ["src-tauri/capabilities/default.json", JSON.stringify({ identifier: "default", permissions: [] })],
  ]), []);
});

test("rejects active macOS CI and packaging drift", () => {
  const workflowFailures = checkWorkflowText("on: { pull_request: {} }\njobs:\n  x:\n    runs-on: macos-latest\n");
  assert.ok(workflowFailures.some((failure) => failure.includes("macOS")));
  const configFailures = checkTauriConfig({
    app: { security: { csp: CSP } },
    bundle: { active: true, targets: ["dmg"] },
  });
  assert.ok(configFailures.some((failure) => failure.includes("macOS")));
  const cspFailures = checkTauriConfig({
    app: { security: { csp: CSP.replace("font-src 'self'", "font-src 'self' data:") } },
    bundle: { active: false, targets: ["nsis", "deb", "appimage"] },
  });
  assert.ok(cspFailures.some((failure) => failure.includes("font-src")));
  const unreviewedCspFailures = checkTauriConfig({
    app: { security: { csp: `${CSP}; script-src-elem *` } },
    bundle: { active: false, targets: ["nsis", "deb", "appimage"] },
  });
  assert.ok(unreviewedCspFailures.some((failure) => failure.includes("outside the reviewed allowlist")));
  const permissiveDefaultFailures = checkTauriConfig({
    app: { security: { csp: CSP.replace("default-src 'self'", "default-src *") } },
    bundle: { active: false, targets: ["nsis", "deb", "appimage"] },
  });
  assert.ok(permissiveDefaultFailures.some((failure) => failure.includes("default-src")));
  const capabilityFailures = checkCapabilityDocuments([
    ["src-tauri/capabilities/default.json", JSON.stringify({ identifier: "default", permissions: ["core:window:allow-set-title"] })],
  ]);
  assert.ok(capabilityFailures.some((failure) => failure.includes("allowlist")));
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
