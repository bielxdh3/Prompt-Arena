import { canonicalJson, sanitizeRecord } from "./roadmap-records";

const MAX_BUNDLE_BYTES = 8 * 1_048_576;

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function exportReproBundle(input: Record<string, unknown>): Promise<string> {
  const body = { schemaVersion: 1, kind: "prompt_arena_repro_bundle", payload: sanitizeRecord(input) };
  const canonical = canonicalJson(body);
  const bytes = new TextEncoder().encode(canonical).byteLength;
  if (bytes > MAX_BUNDLE_BYTES) throw new Error("Repro bundle exceeds the bounded export limit.");
  const manifest = { schemaVersion: 1, files: [{ path: "bundle.json", sha256: await sha256(canonical), bytes }] };
  return JSON.stringify({ ...body, integrity: manifest });
}

export type ReproImportContext = { availableRuntimes?: readonly string[]; availableModels?: readonly string[]; platform?: string };
export async function importReproBundle(serialized: string, context: ReproImportContext = {}): Promise<{ payload: Record<string, unknown>; integrityVerified: true; differences: string[] }> {
  if (new TextEncoder().encode(serialized).byteLength > MAX_BUNDLE_BYTES) throw new Error("Repro bundle exceeds the bounded import limit.");
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new Error("Repro bundle is malformed JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Repro bundle shape is invalid.");
  const root = parsed as Record<string, unknown>;
  if (root.schemaVersion !== 1 || root.kind !== "prompt_arena_repro_bundle" || !root.payload || typeof root.payload !== "object" || Array.isArray(root.payload)) throw new Error("Unsupported repro bundle schema.");
  const files = (root.integrity as Record<string, unknown> | undefined)?.files;
  if (!Array.isArray(files) || files.length !== 1 || (files[0] as Record<string, unknown>)?.path !== "bundle.json") throw new Error("Repro bundle integrity manifest is invalid.");
  const body = { schemaVersion: 1, kind: "prompt_arena_repro_bundle", payload: root.payload };
  const expected = (files[0] as Record<string, unknown>).sha256;
  if (typeof expected !== "string" || expected !== await sha256(canonicalJson(body))) throw new Error("Repro bundle integrity verification failed.");
  const payload = root.payload as Record<string, unknown>;
  const differences: string[] = [];
  const profile = payload.profileRevision && typeof payload.profileRevision === "object" && !Array.isArray(payload.profileRevision) ? payload.profileRevision as Record<string, unknown> : null;
  const runtime = typeof profile?.runtime === "string" ? profile.runtime : null;
  if (runtime && context.availableRuntimes && !context.availableRuntimes.includes(runtime)) differences.push(`runtime unavailable: ${runtime}`);
  const model = typeof profile?.model === "string" ? profile.model : null;
  if (model && context.availableModels && !context.availableModels.includes(model)) differences.push(`model unavailable: ${model}`);
  const hardware = payload.hardware && typeof payload.hardware === "object" && !Array.isArray(payload.hardware) ? payload.hardware as Record<string, unknown> : null;
  if (hardware && context.platform && typeof hardware.platform === "string" && hardware.platform !== context.platform) differences.push(`hardware platform differs: ${hardware.platform} -> ${context.platform}`);
  return { payload, integrityVerified: true, differences };
}
