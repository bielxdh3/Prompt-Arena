import { describe, expect, it } from "vitest";
import { createRunCancellationController } from "./run-cancellation";

describe("run cancellation controller", () => {
  it("stops queued work and cancels only the active run ID once", async () => {
    const controller = createRunCancellationController();
    controller.begin();
    controller.setActive("suite-attempt-run-1");
    const cancelled: string[] = [];

    expect(controller.shouldContinue()).toBe(true);
    expect(await controller.request(async (runId) => { cancelled.push(runId); return true; })).toBe("requested");
    expect(controller.shouldContinue()).toBe(false);
    controller.clearActive("suite-attempt-run-1");
    controller.setActive("suite-attempt-run-2");
    expect(await controller.request(async (runId) => { cancelled.push(runId); return true; })).toBe("already_requested");
    expect(cancelled).toEqual(["suite-attempt-run-1"]);
  });

  it("reports queued, already-finished, and unavailable cancellation outcomes", async () => {
    const controller = createRunCancellationController();
    controller.begin();
    expect(await controller.request(async () => true)).toBe("queued");
    controller.begin();
    controller.setActive("run-finished");
    expect(await controller.request(async () => false)).toBe("already_finished");
    controller.begin();
    controller.setActive("run-unavailable");
    expect(await controller.request(async () => { throw new Error("bridge failed"); })).toBe("failed");
  });
});
