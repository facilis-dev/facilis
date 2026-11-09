import { describe, expect, it } from "vitest";
import { tourStepsFor } from "./tour-steps";
import type { TourAction, TourAnchorId, TourPlacement, TourStepId } from "./tour-types";

const STEP_IDS: readonly TourStepId[] = [
  "graph",
  "activity",
  "explorer",
  "chat",
  "preview",
  "console",
  "status",
  "finale",
];

const ANCHORS: readonly TourAnchorId[] = [
  "editor",
  "activity",
  "sidebar",
  "preview",
  "console",
  "status",
];

const ACTIONS: readonly TourAction[] = [
  "none",
  "showExplorer",
  "showChat",
  "showPreview",
  "showConsole",
];

const PLACEMENTS: readonly TourPlacement[] = ["top", "bottom", "left", "right"];

describe("tourStepsFor", () => {
  it("lists the eight steps of the tour in order when chat is enabled", () => {
    expect(tourStepsFor({ chatEnabled: true }).map((step) => step.id)).toEqual(STEP_IDS);
  });

  it("drops the chat step when chat is disabled", () => {
    expect(tourStepsFor({ chatEnabled: false }).map((step) => step.id)).toEqual(
      STEP_IDS.filter((id) => id !== "chat"),
    );
  });

  it("keys every card by its step id", () => {
    for (const step of tourStepsFor({ chatEnabled: true })) {
      expect(step.titleKey).toBe(`tour.step.${step.id}.title`);
      expect(step.bodyKey).toBe(`tour.step.${step.id}.body`);
    }
  });

  it("highlights nothing only on the finale", () => {
    for (const step of tourStepsFor({ chatEnabled: true })) {
      expect(step.anchor === null).toBe(step.id === "finale");
    }
  });

  it("matches the contract's anchors, actions and placements", () => {
    const steps = tourStepsFor({ chatEnabled: true });
    expect(steps.map((step) => step.anchor)).toEqual([
      "editor",
      "activity",
      "sidebar",
      "sidebar",
      "preview",
      "console",
      "status",
      null,
    ]);
    expect(steps.map((step) => step.action)).toEqual([
      "none",
      "none",
      "showExplorer",
      "showChat",
      "showPreview",
      "showConsole",
      "none",
      "none",
    ]);
    expect(steps.map((step) => step.placement)).toEqual([
      "bottom",
      "right",
      "right",
      "right",
      "left",
      "top",
      "top",
      "bottom",
    ]);
  });

  it("stays inside the tour vocabulary", () => {
    for (const step of tourStepsFor({ chatEnabled: true })) {
      if (step.anchor !== null) expect(ANCHORS).toContain(step.anchor);
      expect(ACTIONS).toContain(step.action);
      expect(PLACEMENTS).toContain(step.placement);
    }
  });

  it("keeps step ids unique", () => {
    const ids = tourStepsFor({ chatEnabled: true }).map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
