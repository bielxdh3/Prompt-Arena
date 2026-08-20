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
const REQUIRED_PACKAGING_TARGETS = ["appimage", "deb", "nsis"];
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

  const installIndex = active.indexOf("npm install --no-audit --no-fund");
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
  const targets = config?.bundle?.targets;
  if (config?.bundle?.active !== false) failures.push("Tauri bundling must remain inactive");
  if (!Array.isArray(targets) || JSON.stringify([...targets].sort()) !== JSON.stringify(REQUIRED_PACKAGING_TARGETS)) {
    failures.push("Tauri packaging targets must remain the reviewed Windows/Linux set");
  }
  if (Array.isArray(targets) && targets.some((target) => /mac|darwin|dmg|pkg/i.test(String(target)))) {
    failures.push("Tauri packaging must not include macOS targets");
  }

  const csp = config?.app?.security?.csp;
  if (typeof csp !== "string") {
    failures.push("Tauri CSP must be present");
    return failures;
  }
  for (const directive of ["style-src 'self'", "font-src 'self'", "script-src 'self'"]) {
    if (!csp.includes(directive)) failures.push(`Tauri CSP must retain ${directive}`);
  }
  for (const source of ["http://localhost:1420", "ws://localhost:1420", "ipc:", "http://ipc.localhost"]) {
    if (!csp.includes(source)) failures.push(`Tauri CSP must retain its local source ${source}`);
  }
  const fontDirective = csp.match(/(?:^|;)\s*font-src\s+([^;]+)/i)?.[1] ?? "";
  if (fontDirective !== "'self'" || /https?:|data:|\*/i.test(fontDirective)) {
    failures.push("Tauri CSP fonts must remain local-only");
  }
  if (/fonts\.(?:googleapis|gstatic)\./i.test(csp)) failures.push("Tauri CSP must not allow external font services");
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
  failures.push(...checkWorkflowText(workflow));
  failures.push(...checkTauriConfig(config));
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
