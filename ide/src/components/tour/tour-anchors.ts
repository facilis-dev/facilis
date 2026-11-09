import type { Rect } from "@/tour/tour-geometry";
import type { TourAnchorId } from "@/tour/tour-types";

/** How to find each highlighted surface. The components own the `data-tour`
 * attribute; this map is the only place that knows the attribute values. */
export const TOUR_ANCHOR_SELECTORS: Record<TourAnchorId, string> = {
  editor: '[data-tour="editor"]',
  activity: '[data-tour="activity"]',
  sidebar: '[data-tour="sidebar"]',
  preview: '[data-tour="preview"]',
  console: '[data-tour="console"]',
  status: '[data-tour="status"]',
};

/** The anchor box in viewport coordinates, or null while it is not mounted. */
export function rectOf(selector: string): Rect | null {
  const element = document.querySelector(selector);
  if (element === null) return null;
  const rect = element.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}
