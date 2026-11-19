import { describe, expect, it, vi } from "vitest";
import { createProjectOpenGuard } from "./project-open";

const noop = (): void => {};

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = noop;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createProjectOpenGuard", () => {
  it("no-ops a same-root open while one is in flight, then allows the next", async () => {
    const guard = createProjectOpenGuard();
    const gate = deferred();
    const open = vi.fn(() => gate.promise);
    const first = guard("/w/a", open);
    const second = guard("/w/a", open);
    await second; // resolves immediately; the first is still running
    expect(open).toHaveBeenCalledTimes(1);
    gate.resolve();
    await first;
    const third = vi.fn(async () => {});
    await guard("/w/a", third);
    expect(third).toHaveBeenCalledTimes(1);
  });

  it("keeps different roots independent", async () => {
    const guard = createProjectOpenGuard();
    const gateA = deferred();
    const gateB = deferred();
    const openA = vi.fn(() => gateA.promise);
    const openB = vi.fn(() => gateB.promise);
    const a = guard("/w/a", openA);
    const b = guard("/w/b", openB);
    expect(openA).toHaveBeenCalledTimes(1);
    expect(openB).toHaveBeenCalledTimes(1);
    gateB.resolve();
    await b;
    gateA.resolve();
    await a;
  });

  it("releases the root when the open throws", async () => {
    const guard = createProjectOpenGuard();
    const failing = vi.fn(async () => {
      throw new Error("restore failed");
    });
    await expect(guard("/w/a", failing)).rejects.toThrow("restore failed");
    const retry = vi.fn(async () => {});
    await guard("/w/a", retry);
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
