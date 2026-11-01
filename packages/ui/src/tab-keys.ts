/**
 * ARIA tabs keyboard pattern shared by the kit's tablists: arrows wrap, Home/End jump to the
 * edges. Pure so the key -> index mapping is testable without a DOM.
 */

export const TAB_NAVIGATION_KEYS = ["ArrowLeft", "ArrowRight", "Home", "End"] as const;

export type TabNavigationKey = (typeof TAB_NAVIGATION_KEYS)[number];

/**
 * Returns the tab index the key should move to, or null when the key is not part of the pattern.
 * An out-of-range current index is normalised to the first tab before moving.
 */
export function nextTabIndex(key: string, current: number, length: number): number | null {
  if (length <= 0) return null;
  const index = current >= 0 && current < length ? current : 0;

  switch (key) {
    case "ArrowLeft":
      return (index - 1 + length) % length;
    case "ArrowRight":
      return (index + 1) % length;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return null;
  }
}
