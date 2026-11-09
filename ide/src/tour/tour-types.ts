// The guided tour's shared vocabulary: steps, anchors and placement sides.
// Kept free of React and DOM so the store and geometry stay pure and testable.
import type { MessageKey } from "@/i18n";

export type TourStepId =
  "graph" | "activity" | "explorer" | "chat" | "preview" | "console" | "status" | "finale";

export type TourAnchorId = "editor" | "activity" | "sidebar" | "preview" | "console" | "status";

export type TourPlacement = "top" | "bottom" | "left" | "right";

export type TourAction = "none" | "showExplorer" | "showChat" | "showPreview" | "showConsole";

export interface TourStep {
  readonly id: TourStepId;
  /** null for the closing card, which highlights no element. */
  readonly anchor: TourAnchorId | null;
  /** What the overlay must open before it can measure the anchor. */
  readonly action: TourAction;
  readonly placement: TourPlacement;
  readonly titleKey: MessageKey;
  readonly bodyKey: MessageKey;
}
