// The tour's step list, in narrative order: the graph, the surfaces that change
// what you see, the tools that open panels, then the closing card. The chat step is
// optional because a project can run with the AI chat disabled.
import type { TourAction, TourAnchorId, TourPlacement, TourStep, TourStepId } from "./tour-types";

export interface TourStepsContext {
  readonly chatEnabled: boolean;
}

interface StepShape {
  readonly id: TourStepId;
  readonly anchor: TourAnchorId | null;
  readonly action: TourAction;
  readonly placement: TourPlacement;
  /** Omitted entirely when the chat panel is disabled, rather than shown broken. */
  readonly needsChat?: boolean;
}

const STEP_SHAPES: readonly StepShape[] = [
  { id: "graph", anchor: "editor", action: "none", placement: "bottom" },
  { id: "activity", anchor: "activity", action: "none", placement: "right" },
  { id: "explorer", anchor: "sidebar", action: "showExplorer", placement: "right" },
  { id: "chat", anchor: "sidebar", action: "showChat", placement: "right", needsChat: true },
  { id: "preview", anchor: "preview", action: "showPreview", placement: "left" },
  { id: "console", anchor: "console", action: "showConsole", placement: "top" },
  { id: "status", anchor: "status", action: "none", placement: "top" },
  { id: "finale", anchor: null, action: "none", placement: "bottom" },
];

export function tourStepsFor(ctx: TourStepsContext): readonly TourStep[] {
  return STEP_SHAPES.filter((step) => !step.needsChat || ctx.chatEnabled).map((step) => ({
    id: step.id,
    anchor: step.anchor,
    action: step.action,
    placement: step.placement,
    titleKey: `tour.step.${step.id}.title`,
    bodyKey: `tour.step.${step.id}.body`,
  }));
}
