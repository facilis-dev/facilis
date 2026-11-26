// The dirty-only redraw loop (D-219, issue #184, kept under test by #186): a frame draws only
// when something marked the surface dirty, so idle frames cost one boolean check and zero draw
// work. Scheduling is injected (requestAnimationFrame in the app, a fake queue in tests), which
// keeps the loop unit-testable without a DOM.

export interface FrameLoopOptions {
  readonly isDirty: () => boolean;
  /** Draws one frame; the caller clears the dirty flag here, before drawing. */
  readonly draw: () => void;
  readonly requestFrame: (callback: () => void) => number;
  readonly cancelFrame: (handle: number) => void;
}

export interface FrameLoop {
  readonly stop: () => void;
}

export function startDirtyFrameLoop(options: FrameLoopOptions): FrameLoop {
  let stopped = false;
  let handle = 0;
  const frame = (): void => {
    if (stopped) return;
    handle = options.requestFrame(frame);
    if (!options.isDirty()) return;
    options.draw();
  };
  handle = options.requestFrame(frame);
  return {
    stop() {
      stopped = true;
      options.cancelFrame(handle);
    },
  };
}
