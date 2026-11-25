// The dirty-only redraw loop (D-211, issues #184/#186): idle frames must do ZERO draw work,
// a dirty frame draws exactly once, and stopping cancels the pending frame. Scheduling is a
// fake frame queue here, so the assertions are exact frame counts, not wall-clock guesses.
import { describe, expect, it } from "vitest";
import { startDirtyFrameLoop } from "./frame-loop.ts";

function fakeFrames() {
  const pending = new Map<number, () => void>();
  let nextHandle = 1;
  return {
    requestFrame: (callback: () => void): number => {
      const handle = nextHandle;
      nextHandle += 1;
      pending.set(handle, callback);
      return handle;
    },
    cancelFrame: (handle: number): void => {
      pending.delete(handle);
    },
    /** Run exactly one animation frame (the loop re-registers itself inside it). */
    tick: (): void => {
      const due = [...pending.values()];
      pending.clear();
      for (const callback of due) callback();
    },
    pendingCount: () => pending.size,
  };
}

describe("startDirtyFrameLoop", () => {
  it("idle frames do no draw work", () => {
    const frames = fakeFrames();
    let draws = 0;
    startDirtyFrameLoop({
      isDirty: () => false,
      draw: () => {
        draws += 1;
      },
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });
    for (let i = 0; i < 120; i += 1) frames.tick();
    expect(draws).toBe(0);
    expect(frames.pendingCount()).toBe(1); // the loop stays scheduled, cheaply
  });

  it("a dirty frame draws exactly once, then idle frames are free again", () => {
    const frames = fakeFrames();
    let dirty = false;
    let draws = 0;
    startDirtyFrameLoop({
      isDirty: () => dirty,
      draw: () => {
        dirty = false; // the surface clears the flag before drawing
        draws += 1;
      },
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });
    frames.tick();
    expect(draws).toBe(0);
    dirty = true;
    frames.tick();
    expect(draws).toBe(1);
    for (let i = 0; i < 60; i += 1) frames.tick();
    expect(draws).toBe(1);
    dirty = true;
    frames.tick();
    expect(draws).toBe(2);
  });

  it("stop cancels the pending frame and never draws again", () => {
    const frames = fakeFrames();
    let draws = 0;
    const loop = startDirtyFrameLoop({
      isDirty: () => true,
      draw: () => {
        draws += 1;
      },
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame,
    });
    loop.stop();
    expect(frames.pendingCount()).toBe(0);
    frames.tick();
    expect(draws).toBe(0);
  });
});
