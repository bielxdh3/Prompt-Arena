import { describe, expect, it } from "vitest";
import { normalizeObjectivePolicy, verifyObjective } from "./objective-verifiers";

describe("objective verifiers", () => {
  it("supports exact, numeric, classification, and safe pattern checks", () => {
    expect(verifyObjective({ kind: "exact_text", expected: "yes" }, " yes\r\n").passed).toBe(true);
    expect(verifyObjective({ kind: "numeric_tolerance", expected: 10, tolerance: 0.2 }, "10.1").passed).toBe(true);
    expect(verifyObjective({ kind: "classification", expected: "PASS" }, "pass").passed).toBe(true);
    expect(verifyObjective({ kind: "safe_pattern", pattern: "^ok$" }, "ok").passed).toBe(true);
  });

  it("checks bounded JSON fields and rejects unsafe patterns", () => {
    expect(verifyObjective({ kind: "required_fields", fields: ["answer.value"] }, '{"answer":{"value":1}}').passed).toBe(true);
    expect(verifyObjective({ kind: "json_schema", expected: {}, required: ["label"] }, '{"label":"ok"}').passed).toBe(true);
    expect(verifyObjective({ kind: "safe_pattern", pattern: "(?<bad>ok)" }, "ok").passed).toBe(false);
    expect(verifyObjective({ kind: "safe_pattern", pattern: "(a+)+$" }, `${"a".repeat(32)}!`).passed).toBe(false);
    expect(normalizeObjectivePolicy({ kind: "numeric_tolerance", expected: 1, tolerance: 0.1 })).toEqual({ kind: "numeric_tolerance", expected: 1, tolerance: 0.1 });
  });
});
