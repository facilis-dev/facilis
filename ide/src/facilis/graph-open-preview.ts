// "Open in preview" from the project-graph inspector: reveal the Preview panel and point a
// tab at the page's URL. A mounted dev server already has a tab with a port, so that tab is
// navigated (a full reload on the new path, the D-111 behaviour); with no server yet, the new
// tab carries the path so the first paint lands on the requested page instead of the root.

import type { IdeController } from "@/vv/controller";

/** A wildcard route has no concrete URL; a path parameter gets a placeholder value. */
function previewablePath(path: string): string | null {
  if (!path.startsWith("/") || path.includes("*")) return null;
  return path.replace(/\{[^}]+\}/g, "1").replace(/:[A-Za-z0-9_]+/g, "1");
}

export function openPageInPreview(controller: IdeController, path: string): void {
  const target = previewablePath(path);
  if (target === null) return;
  controller.togglePreview(true);
  const active = controller.preview.activePreviewTab();
  if (active !== null) {
    controller.preview.navigatePreviewPath(active.id, target);
    return;
  }
  controller.preview.addPreviewTab("", target);
}
