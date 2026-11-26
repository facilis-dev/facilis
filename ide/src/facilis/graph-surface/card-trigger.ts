// Double-tap detection for the graph surface (issue #188). Mouse double-click and touch
// double-tap both arrive as two clicks inside the pointer hook; this pure predicate keeps the
// window and identity rule out of the canvas component so it can be unit-tested.

export const DOUBLE_TAP_MS = 320;

export interface TapMark {
  readonly id: string;
  readonly at: number;
}

/** True when the same node is clicked twice inside the window; a stale or different tap is not. */
export function isDoubleTap(previous: TapMark | null, id: string, now: number): boolean {
  if (previous === null || previous.id !== id) return false;
  const elapsed = now - previous.at;
  return elapsed >= 0 && elapsed <= DOUBLE_TAP_MS;
}
