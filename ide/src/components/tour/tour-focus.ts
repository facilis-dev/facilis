// Focus handoff for the guided tour (issue #218): remember where the tour was opened from, so
// finishing or dismissing returns focus there instead of dropping it on <body>. The opener is
// recorded at the call site because #217 makes the workspace frame inert on the commit that
// opens the overlay, and the browser blurs the opener during that commit — an effect inside
// the overlay would only ever read <body>.
import { restoreWorkspaceFocus } from "@/components/ide/home-focus";
import { tourStore } from "./tour-store-instance";

let opener: HTMLElement | null = null;

/** Open the tour, recording the control that asked for it. A null opener (the command
 * palette or the first-run auto-start) resolves to Home's stable title-bar fallback. */
export function startTour(openerElement: HTMLElement | null): void {
  opener = openerElement;
  tourStore.start();
}

/** Hand focus back to the opener when the tour really ends. Not consumed: the restore is
 * idempotent, which keeps a StrictMode remount from losing the opener. */
export function restoreTourFocus(): void {
  restoreWorkspaceFocus(opener);
}
