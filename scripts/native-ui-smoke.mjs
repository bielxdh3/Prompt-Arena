import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const WEBDRIVER = "http://127.0.0.1:4444";
const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";
const application = path.resolve(process.argv[2] || process.env.PROMPT_ARENA_APP || "");

if (!application || !fs.existsSync(application)) {
  throw new Error(`Prompt Arena application binary not found: ${application || "missing"}`);
}

let tauriDriver = null;
let sessionId = null;
let shuttingDown = false;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(method, pathname, body) {
  const response = await fetch(`${WEBDRIVER}${pathname}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`WebDriver returned non-JSON (${response.status}): ${text.slice(0, 500)}`);
  }
  if (!response.ok || payload?.value?.error) {
    const detail = payload?.value?.message || payload?.value?.error || text;
    throw new Error(`WebDriver ${method} ${pathname} failed (${response.status}): ${detail}`);
  }
  return payload?.value;
}

async function waitForDriver(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      await request("GET", "/status");
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(`tauri-driver did not become ready: ${lastError instanceof Error ? lastError.message : lastError}`);
}

async function startSession() {
  const value = await request("POST", "/session", {
    capabilities: {
      alwaysMatch: {
        browserName: "wry",
        "tauri:options": { application },
      },
    },
  });
  const id = value?.sessionId;
  assert(typeof id === "string" && id.length > 0, "WebDriver session id was not returned");
  sessionId = id;
  return id;
}

async function stopSession() {
  if (!sessionId) return;
  const id = sessionId;
  sessionId = null;
  try {
    await request("DELETE", `/session/${id}`);
  } catch (error) {
    console.warn(`session cleanup warning: ${error instanceof Error ? error.message : error}`);
  }
}

async function execute(script, args = []) {
  assert(sessionId, "WebDriver session is not active");
  return request("POST", `/session/${sessionId}/execute/sync`, { script, args });
}

async function executeAsync(script, args = []) {
  assert(sessionId, "WebDriver session is not active");
  return request("POST", `/session/${sessionId}/execute/async`, { script, args });
}

async function findElements(using, value) {
  assert(sessionId, "WebDriver session is not active");
  return request("POST", `/session/${sessionId}/elements`, { using, value });
}

async function getText(elementId) {
  return request("GET", `/session/${sessionId}/element/${elementId}/text`);
}

async function waitForText(selector, expected, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  while (Date.now() < deadline) {
    const elements = await findElements("css selector", selector);
    if (Array.isArray(elements) && elements.length > 0) {
      const id = elements[0]?.[ELEMENT_KEY];
      if (id) {
        lastText = String(await getText(id));
        if (lastText.includes(expected)) return lastText;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${selector} to contain ${JSON.stringify(expected)}; last=${JSON.stringify(lastText)}`);
}

async function clickNav(label) {
  const clicked = await execute(`
    const label = arguments[0];
    const button = [...document.querySelectorAll('button.nav-item')]
      .find((candidate) => candidate.textContent?.includes(label));
    if (!button) return false;
    button.click();
    return true;
  `, [label]);
  assert(clicked === true, `navigation button not found: ${label}`);
  await waitForText("h1", label);
}

async function invoke(command, args = {}) {
  const result = await executeAsync(`
    const command = arguments[0];
    const args = arguments[1];
    const done = arguments[arguments.length - 1];
    const internals = window.__TAURI_INTERNALS__;
    if (!internals || typeof internals.invoke !== 'function') {
      done({ ok: false, error: 'window.__TAURI_INTERNALS__.invoke is unavailable' });
      return;
    }
    internals.invoke(command, args)
      .then((value) => done({ ok: true, value }))
      .catch((error) => done({
        ok: false,
        error: typeof error === 'string' ? error : JSON.stringify(error),
      }));
  `, [command, args]);
  assert(result && result.ok === true, `Tauri invoke ${command} failed: ${result?.error || "unknown error"}`);
  return result.value;
}

function nativeSidecarPlan(runId) {
  return {
    runId,
    benchmarkVersionId: "native-ui-smoke-v1",
    caseId: "native-ui-smoke-case",
    profileRevision: {
      profileId: "native-ui-smoke-profile",
      profileRevisionId: "native-ui-smoke-profile@1",
      revision: 1,
      model: "prompt-arena-native-smoke-model-does-not-exist",
      runtime: "ollama",
      parameters: {},
      systemPrompt: null,
    },
    generation: {
      model: "prompt-arena-native-smoke-model-does-not-exist",
      prompt: "native sidecar smoke",
      messages: [],
      systemPrompt: null,
      parameters: {
        temperature: null,
        topP: null,
        topK: null,
        maxTokens: 8,
        repeatPenalty: null,
        presencePenalty: null,
        frequencyPenalty: null,
      },
      stopSequences: [],
      seed: 1,
      tools: [],
      toolPolicy: "none",
      responseFormat: "Text",
      metadata: { acceptance: "native-webdriver" },
    },
    runtimeConfig: {
      endpoint: "http://127.0.0.1:11434",
      connectTimeoutMs: 250,
      readTimeoutMs: 500,
      readDeadlineMs: 750,
    },
    objectiveExpectation: null,
    verifierPolicy: null,
    executionBoundary: {
      kind: "text_generation",
      status: "available",
      reason: null,
    },
    metadata: { acceptance: "native-webdriver" },
  };
}

async function firstSession(runId) {
  await startSession();
  await waitForText(".status-chip.is-ready", "Local app ready");

  const bridgeErrors = await findElements("css selector", ".bridge-error");
  assert(Array.isArray(bridgeErrors) && bridgeErrors.length === 0, "native desktop unexpectedly rendered bridge-error");

  const hasInternals = await execute("return Boolean(window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function');");
  assert(hasInternals === true, "native WebView did not expose Tauri invoke internals to the application context");

  const status = await invoke("app_status");
  assert(status?.appName === "Prompt Arena", `unexpected appName: ${status?.appName}`);
  assert(status?.storageState === "local", `unexpected storageState: ${status?.storageState}`);
  assert(["windows", "linux"].includes(status?.supportedPlatform), `unsupported native platform: ${status?.supportedPlatform}`);

  const packs = await invoke("list_official_packs");
  assert(Array.isArray(packs) && packs.length >= 3, `expected at least 3 official packs, got ${Array.isArray(packs) ? packs.length : "non-array"}`);

  const profiles = await invoke("list_profile_revisions");
  const runsBefore = await invoke("list_runs");
  const summaries = await invoke("list_arena_summaries");
  assert(Array.isArray(profiles), "list_profile_revisions did not return an array");
  assert(Array.isArray(runsBefore), "list_runs did not return an array");
  assert(Array.isArray(summaries), "list_arena_summaries did not return an array");

  for (const label of ["Arena", "Advanced Arena", "Benchmarks", "Models", "Runs", "Settings", "Overview"]) {
    await clickNav(label);
  }
  await clickNav("Settings");
  await waitForText(".diagnostics-panel", "Desktop bridge");

  const sidecarResult = await invoke("execute_run_once", { plan: nativeSidecarPlan(runId) });
  assert(sidecarResult && typeof sidecarResult === "object", "execute_run_once did not return persisted terminal evidence");

  const runsAfter = await invoke("list_runs");
  assert(Array.isArray(runsAfter), "list_runs after sidecar invocation did not return an array");
  assert(runsAfter.some((run) => run?.runId === runId), "native sidecar run was not persisted");

  await stopSession();
}

async function reopenedSession(runId) {
  await new Promise((resolve) => setTimeout(resolve, 750));
  await startSession();
  await waitForText(".status-chip.is-ready", "Local app ready");
  const reopenedRuns = await invoke("list_runs");
  assert(Array.isArray(reopenedRuns) && reopenedRuns.some((run) => run?.runId === runId), "persisted native run did not survive application restart/reopen");
  await clickNav("Runs");
  await stopSession();
}

async function main() {
  console.log(`Native Tauri acceptance app: ${application}`);
  console.log(`Host: ${os.platform()} ${os.release()}`);
  const executable = process.env.TAURI_DRIVER || "tauri-driver";
  tauriDriver = spawn(executable, [], {
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32",
  });
  tauriDriver.on("error", (error) => {
    console.error("tauri-driver process error", error);
  });
  await waitForDriver();

  const runId = `native-ui-smoke-${Date.now()}`;
  await firstSession(runId);
  await reopenedSession(runId);
  console.log(`NATIVE_TAURI_UI_BRIDGE_SIDECAR_REOPEN_ACCEPTED run_id=${runId}`);
}

async function cleanup() {
  if (shuttingDown) return;
  shuttingDown = true;
  await stopSession();
  if (tauriDriver && !tauriDriver.killed) tauriDriver.kill();
}

try {
  await main();
} finally {
  await cleanup();
}
