import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED_LOCKFILES = ["package-lock.json", "src-tauri/Cargo.lock"];
const REQUIRED_IGNORE_RULES = [
  ".env",
  ".env.*",
  "!.env.example",
  "*.local",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.jks",
  "*.keystore",
  "*.secret",
  "*.secrets",
  "*.token",
  "credentials*.json",
  ".npmrc",
  "secrets/",
];
const REQUIRED_PACKAGING_TARGETS = ["appimage", "deb", "msi", "nsis"];
const REQUIRED_WORKER_SIDECAR = "binaries/prompt-arena-worker";
const REQUIRED_DEV_COMMAND = "npm run dev";
const REQUIRED_BUILD_COMMAND = "npm run prepare:worker-sidecar && npm run build";
const ALLOWED_TAURI_PERMISSIONS = new Set();
const REVIEWED_CSP_ALLOWLISTS = {
  "default-src": ["'self'"],
  "script-src": ["'self'"],
  "style-src": ["'self'"],
  "font-src": ["'self'"],
  "connect-src": ["'self'", "http://localhost:1420", "ws://localhost:1420", "ipc:", "http://ipc.localhost"],
  "img-src": ["'self'", "asset:", "https://asset.localhost", "data:"],
};
const SECRET_PATH_PATTERNS = [
  /(^|\/)\.env(?:\..*)?$/i,
  /(^|\/)(?:id_rsa|id_ed25519|auth\.json|credentials(?:\.[^/]+)?|secrets?\.(?:json|ya?ml|txt)|token\.(?:json|txt))$/i,
  /\.(?:pem|key|p12|pfx|jks|keystore|secret|secrets|token)$/i,
  /(^|\/)\.npmrc$/i,
  /\.local$/i,
];
const OBVIOUS_KEY_PATTERNS = [
  new RegExp(["sk-", "[A-Za-z0-9]{20,}"].join("")),
  new RegExp(["AIza", "[0-9A-Za-z_-]{20,}"].join("")),
  new RegExp(["AKIA", "[0-9A-Z]{16}"].join("")),
  new RegExp(["ghp_", "[A-Za-z0-9]{20,}"].join("")),
  new RegExp(["github_pat_", "[A-Za-z0-9_]{20,}"].join("")),
  new RegExp(["xox[baprs]-", "[A-Za-z0-9-]{20,}"].join("")),
  new RegExp(["-----BEGIN ", "(?:RSA |EC |OPENSSH )?", "PRIVATE KEY-----"].join("")),
];

function activeWorkflowText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s+)#.*$/, "$1"))
    .join("\n");
}

export function checkWorkflowText(text) {
  const active = activeWorkflowText(text);
  const failures = [];
  if (!/os:\s*\[\s*(?:windows-latest\s*,\s*ubuntu-latest|ubuntu-latest\s*,\s*windows-latest)\s*\]/.test(active)) {
    failures.push("CI must keep an explicit Windows/Linux runner matrix");
  }
  if (!/runs-on:\s*\$\{\{\s*matrix\.os\s*\}\}/.test(active)) {
    failures.push("CI must run the existing matrix on each job");
  }
  if (!/\bpull_request\s*:/.test(active)) failures.push("CI must retain pull-request validation");
  if (/\b(?:macos(?:-latest)?|darwin)\b/i.test(active)) failures.push("CI must not add an active macOS runner");

  const installIndex = active.indexOf("npm ci --no-audit --no-fund");
  for (const command of ["npm run check:boundaries", "npm audit --omit=dev --audit-level=high"]) {
    if (installIndex < 0 || active.indexOf(command) <= installIndex) {
      failures.push(`CI must run ${command} after dependency installation`);
    }
  }
  if (/\brun:\s*[^\n]*(?:\b(?:release|deploy|publish|sign)\b|tauri\s+build)/i.test(active)) {
    failures.push("CI must not publish, deploy, sign, or package releases");
  }
  return failures;
}

export function checkTauriConfig(config) {
  const failures = [];
  if (config?.build?.beforeDevCommand !== REQUIRED_DEV_COMMAND) {
    failures.push("Tauri development must retain the frontend-only dev hook");
  }
  if (config?.build?.beforeBuildCommand !== REQUIRED_BUILD_COMMAND) {
    failures.push("Tauri release builds must prepare the worker sidecar before the frontend build");
  }
  const bundle = config?.bundle;
  const targets = bundle?.targets;
  if (bundle?.active !== true) failures.push("Tauri worker bundling must be active");
  if (!Array.isArray(targets) || JSON.stringify([...targets].sort()) !== JSON.stringify(REQUIRED_PACKAGING_TARGETS)) {
    failures.push("Tauri packaging targets must remain the reviewed Windows/Linux set");
  }
  if (Array.isArray(targets) && targets.some((target) => /mac|darwin|dmg|pkg/i.test(String(target)))) {
    failures.push("Tauri packaging must not include macOS targets");
  }
  if (
    !Array.isArray(bundle?.externalBin)
    || bundle.externalBin.length !== 1
    || bundle.externalBin[0] !== REQUIRED_WORKER_SIDECAR
  ) {
    failures.push("Tauri external binaries must contain only the fixed worker sidecar");
  }

  const csp = config?.app?.security?.csp;
  if (typeof csp !== "string") {
    failures.push("Tauri CSP must be present");
    return failures;
  }
  const { directives, duplicateDirectives } = parseCspDirectives(csp);
  for (const [directive, expectedSources] of Object.entries(REVIEWED_CSP_ALLOWLISTS)) {
    if (duplicateDirectives.has(directive)) {
      failures.push(`Tauri CSP must not duplicate ${directive}`);
      continue;
    }
    const actualSources = directives.get(directive);
    if (!actualSources || !sameAllowlist(actualSources, expectedSources)) {
      failures.push(`Tauri CSP ${directive} must equal the reviewed local allowlist`);
    }
  }
  for (const directive of directives.keys()) {
    if (!Object.hasOwn(REVIEWED_CSP_ALLOWLISTS, directive)) {
      failures.push(`Tauri CSP directive is outside the reviewed allowlist: ${directive}`);
    }
  }
  if (/fonts\.(?:googleapis|gstatic)\./i.test(csp)) failures.push("Tauri CSP must not allow external font services");
  return failures;
}

function parseCspDirectives(csp) {
  const directives = new Map();
  const duplicateDirectives = new Set();
  for (const segment of csp.split(";")) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const directive = tokens.shift().toLowerCase();
    if (directives.has(directive)) {
      duplicateDirectives.add(directive);
    } else {
      directives.set(directive, tokens);
    }
  }
  return { directives, duplicateDirectives };
}

function sameAllowlist(actual, expected) {
  return actual.length === expected.length
    && new Set(actual).size === actual.length
    && actual.every((source) => expected.includes(source));
}

export function checkCapabilityDocuments(entries) {
  const failures = [];
  if (!Array.isArray(entries) || entries.length === 0) {
    return ["tracked Tauri capability JSON files are required"];
  }
  for (const entry of entries) {
    const filePath = Array.isArray(entry) ? entry[0] : "unknown";
    const contents = Array.isArray(entry) ? entry[1] : null;
    const normalized = String(filePath).replaceAll("\\", "/");
    if (!normalized.startsWith("src-tauri/capabilities/") || !normalized.endsWith(".json")) {
      failures.push(`unexpected Tauri capability path: ${normalized}`);
      continue;
    }
    let capability;
    try {
      capability = JSON.parse(contents);
    } catch {
      failures.push(`Tauri capability JSON is invalid: ${normalized}`);
      continue;
    }
    if (capability === null || typeof capability !== "object" || Array.isArray(capability)) {
      failures.push(`Tauri capability JSON must be an object: ${normalized}`);
      continue;
    }
    if (typeof capability.identifier !== "string" || capability.identifier.trim() === "") {
      failures.push(`Tauri capability identifier is missing: ${normalized}`);
    }
    if (!Array.isArray(capability.permissions)) {
      failures.push(`Tauri capability permissions must be an array: ${normalized}`);
      continue;
    }
    if (capability.permissions.some((permission) => (
      typeof permission !== "string" || !ALLOWED_TAURI_PERMISSIONS.has(permission)
    ))) {
      failures.push(`Tauri capability contains a permission outside the reviewed allowlist: ${normalized}`);
    }
  }
  return failures;
}

export function checkIgnoreText(text) {
  const rules = new Set(text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")));
  return REQUIRED_IGNORE_RULES
    .filter((rule) => !rules.has(rule))
    .map((rule) => `.gitignore must contain ${rule}`);
}

export function checkLocalFontText(fontSource, styleSource) {
  const failures = [];
  const fontOptionCount = fontSource.match(/\bid:\s*["'][^"']+["']/g)?.length ?? 0;
  if (fontOptionCount !== 7) failures.push("the fixed local font catalog must retain seven choices");
  if (!/Times New Roman/.test(fontSource)) failures.push("the local font catalog must retain its default font intent");
  if (/(?:@import|font-face|url\(|https?:\/\/|fonts\.(?:googleapis|gstatic)\.)/i.test(`${fontSource}\n${styleSource}`)) {
    failures.push("font styling must not load external fonts or URLs");
  }
  return failures;
}

export function checkLoopbackSources(ollamaSource, runPlanSource) {
  const failures = [];
  if (!/DEFAULT_OLLAMA_ENDPOINT:\s*&str\s*=\s*"http:\/\/127\.0\.0\.1:11434"/.test(ollamaSource)) {
    failures.push("the Ollama adapter must retain the fixed loopback default");
  }
  if (!/DEFAULT_OLLAMA_ENDPOINT\s*=\s*"http:\/\/127\.0\.0\.1:11434"/.test(runPlanSource)) {
    failures.push("run plans must retain the fixed loopback endpoint");
  }
  return failures;
}

export function findSecretLikePaths(paths) {
  return paths.filter((filePath) => {
    const normalized = filePath.replaceAll("\\", "/");
    return normalized !== ".env.example" && SECRET_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
  });
}

export function findObviousKeyMaterial(entries) {
  const hits = [];
  for (const [filePath, contents] of entries) {
    if (typeof contents !== "string" || contents.includes("\0")) continue;
    if (OBVIOUS_KEY_PATTERNS.some((pattern) => pattern.test(contents))) hits.push(filePath);
  }
  return hits;
}

function trackedPaths(repositoryRoot) {
  const gitPath = path.join(repositoryRoot, ".git");
  const gitDirectory = fs.statSync(gitPath).isDirectory()
    ? gitPath
    : path.resolve(repositoryRoot, fs.readFileSync(gitPath, "utf8").match(/^gitdir:\s*(.+)$/m)?.[1] ?? "");
  const index = fs.readFileSync(path.join(gitDirectory, "index"));
  if (index.toString("ascii", 0, 4) !== "DIRC" || index.readUInt32BE(4) !== 2) {
    throw new Error("unsupported Git index");
  }
  const entryCount = index.readUInt32BE(8);
  const paths = [];
  let offset = 12;
  for (let entry = 0; entry < entryCount; entry += 1) {
    const entryStart = offset;
    if (offset + 62 > index.length) throw new Error("invalid Git index");
    const flags = index.readUInt16BE(offset + 60);
    offset += 62 + ((flags & 0x4000) !== 0 ? 2 : 0);
    const terminator = index.indexOf(0, offset);
    if (terminator < 0) throw new Error("invalid Git index path");
    paths.push(index.toString("utf8", offset, terminator));
    offset = terminator + 1;
    while ((offset - entryStart) % 8 !== 0) offset += 1;
  }
  return paths;
}

function readText(repositoryRoot, relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

export function checkRepository(repositoryRoot = REPOSITORY_ROOT) {
  const failures = [];
  const workflow = readText(repositoryRoot, ".github/workflows/ci.yml");
  const config = JSON.parse(readText(repositoryRoot, "src-tauri/tauri.conf.json"));
  const packageManifest = JSON.parse(readText(repositoryRoot, "package.json"));
  failures.push(...checkWorkflowText(workflow));
  failures.push(...checkTauriConfig(config));
  if (packageManifest?.scripts?.["prepare:worker-sidecar"] !== "node scripts/prepare-worker-sidecar.mjs") {
    failures.push("package.json must expose the fixed worker sidecar preparation script");
  }
  if (!fs.existsSync(path.join(repositoryRoot, "scripts/prepare-worker-sidecar.mjs"))) {
    failures.push("worker sidecar preparation script is missing");
  }
  failures.push(...checkIgnoreText(readText(repositoryRoot, ".gitignore")));
  failures.push(...checkLocalFontText(
    readText(repositoryRoot, "src/font-options.ts"),
    readText(repositoryRoot, "src/styles.css"),
  ));
  failures.push(...checkLoopbackSources(
    readText(repositoryRoot, "src-tauri/src/ollama.rs"),
    readText(repositoryRoot, "src/run-plan.ts"),
  ));
  for (const lockfile of REQUIRED_LOCKFILES) {
    if (!fs.existsSync(path.join(repositoryRoot, lockfile))) failures.push(`required lockfile is missing: ${lockfile}`);
  }

  const tracked = trackedPaths(repositoryRoot);
  const capabilityEntries = tracked
    .map((filePath) => filePath.replaceAll("\\", "/"))
    .filter((filePath) => filePath.startsWith("src-tauri/capabilities/") && filePath.endsWith(".json"))
    .map((filePath) => [filePath, readText(repositoryRoot, filePath)]);
  failures.push(...checkCapabilityDocuments(capabilityEntries));
  const secretPaths = findSecretLikePaths(tracked);
  if (secretPaths.length > 0) failures.push(`tracked secret-like paths found: ${secretPaths.join(", ")}`);
  const entries = tracked.map((filePath) => [filePath, readText(repositoryRoot, filePath)]);
  const keyFiles = findObviousKeyMaterial(entries);
  if (keyFiles.length > 0) failures.push(`obvious key material found in tracked file(s): ${keyFiles.join(", ")}`);
  return failures;
}

function isMainModule() {
  return process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
  try {
    const failures = checkRepository();
    if (failures.length > 0) {
      console.error(`Repository boundary check failed with ${failures.length} issue(s).`);
      failures.forEach((failure) => console.error(`- ${failure}`));
      process.exitCode = 1;
    } else {
      console.log("Repository boundary check passed.");
    }
  } catch {
    console.error("Repository boundary check could not complete.");
    process.exitCode = 1;
  }
}
