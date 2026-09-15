import { describe, expect, it } from "vitest";
import { exportReproBundle, importReproBundle } from "./repro-bundle";

describe("repro bundle", () => {
  it("exports secret-free evidence and verifies integrity", async () => {
    const bundle = await exportReproBundle({ runId: "run-alpha", apiKey: "do-not-export", nested: { password: "secret" } });
    expect(bundle).not.toContain("do-not-export");
    const imported = await importReproBundle(bundle);
    expect(imported.integrityVerified).toBe(true);
    expect(imported.payload.runId).toBe("run-alpha");
  });
});
