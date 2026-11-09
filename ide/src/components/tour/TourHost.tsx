import { useEffect, useRef } from "react";
import { useIde } from "@/components/ide/useIde";
import { isAutomationContext, shouldAutoStartTour } from "@/tour/tour-store";
import type { TourAction } from "@/tour/tour-types";
import type { IdeController } from "@/vv/controller";
import { TourOverlay } from "./TourOverlay";
import { tourStore } from "./tour-store-instance";
import { useTour } from "./use-tour";

/** Long enough for the workspace to paint, short enough to feel like part of boot. */
const AUTO_START_DELAY_MS = 800;

function runStepAction(controller: IdeController, action: TourAction): void {
  switch (action) {
    case "none":
      return;
    case "showExplorer":
      controller.setActiveView("explorer");
      return;
    case "showChat":
      controller.setActiveView("chat");
      return;
    case "showPreview":
      controller.togglePreview(true);
      return;
    case "showConsole":
      controller.togglePanel(true);
      return;
  }
}

/** Owns the tour's side effects: opening the surface each step needs, the one-shot
 * first-run start, and ending the tour when the workspace is left. */
export function TourHost() {
  const { c, snap } = useIde();
  const { snapshot, steps, skip } = useTour();
  const autoStarted = useRef(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A headless acceptance run needs to query the tour state without a hook;
  // DEV-only, the same handle pattern as window.__ide for the controller.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    // oxlint-disable-next-line no-underscore-dangle -- dev-only handle mirrors window.__ide.
    (window as unknown as { __ideTour?: typeof tourStore }).__ideTour = tourStore;
  }, []);

  useEffect(() => {
    if (autoStarted.current || autoTimer.current !== null) return;
    if (snap.view !== "workspace" || snap.projectTitle === null || snap.bootProject !== null)
      return;
    const tourDisabled = new URLSearchParams(location.search).get("tour") === "off";
    if (
      !shouldAutoStartTour(tourStore, {
        isAutomation: isAutomationContext(navigator),
        tourDisabled,
      })
    ) {
      return;
    }
    autoTimer.current = setTimeout(() => {
      autoTimer.current = null;
      autoStarted.current = true;
      // A manual replay can win the race; never yank it back to step one.
      if (!tourStore.getSnapshot().active) tourStore.start();
    }, AUTO_START_DELAY_MS);
    return () => {
      if (autoTimer.current !== null) {
        clearTimeout(autoTimer.current);
        autoTimer.current = null;
      }
    };
  }, [snap.view, snap.projectTitle, snap.bootProject]);

  const step = snapshot.active ? (steps[snapshot.index] ?? null) : null;
  const stepId = step?.id ?? null;
  const action = step?.action ?? "none";

  // Opening the panel is the first half of a step; measuring is the second, and
  // the target hook retries across frames so it survives the panel actually mounting.
  useEffect(() => {
    if (!snapshot.active) return;
    runStepAction(c, action);
  }, [snapshot.active, stepId, action, c]);

  // An active tour with no step means the list shrank under it (deployment changed).
  useEffect(() => {
    if (snapshot.active && stepId === null) skip();
  }, [snapshot.active, stepId, skip]);

  // Home is outside the tour's subject: leaving the workspace ends it.
  useEffect(() => {
    if (snapshot.active && snap.view !== "workspace") skip();
  }, [snapshot.active, snap.view, skip]);

  if (!snapshot.active) return null;
  return <TourOverlay />;
}
