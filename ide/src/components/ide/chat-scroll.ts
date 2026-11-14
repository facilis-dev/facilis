// Whether the chat transcript should keep following new content.
//
// The panel auto-scrolls only while the viewport is at (or near) the end: a reader who
// scrolls up to read the reasoning must not be dragged back by the next token, and an
// explicit lock freezes it even at the bottom. Pure number arithmetic so it is unit-tested
// without a DOM (ide/ has no jsdom).

/** How close to the end (px) still counts as "at the bottom". */
export const BOTTOM_SLACK_PX = 24;

export interface ScrollMetrics {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}

/** True when the viewport is close enough to the end to keep following new content. */
export function isAtBottom(
  { scrollTop, clientHeight, scrollHeight }: ScrollMetrics,
  slack: number = BOTTOM_SLACK_PX,
): boolean {
  // scrollHeight - scrollTop - clientHeight is the distance left below the viewport.
  return scrollHeight - scrollTop - clientHeight <= slack;
}
