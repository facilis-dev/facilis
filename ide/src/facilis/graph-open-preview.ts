// "Open in preview" from the project-graph inspector: reveal the Preview panel and point a
// tab at the page's URL. A mounted dev server already has a tab with a port, so that tab is
// navigated (a full reload on the new path, the D-111 behaviour); with no server yet, the new
// tab carries the path so the first paint lands on the requested page instead of the root.

import type { IdeController } from "@/vv/controller";

export function openPageInPreview(controller: IdeController, path: string): void {
  if (!path.startsWith("/")) return;
  controller.togglePreview(true);
  const active = controller.preview.activePreviewTab();
  if (active !== null) {
    controller.preview.navigatePreviewPath(active.id, path);
    return;
  }
  const id = controller.preview.addPreviewTab();
  controller.preview.setPreviewPath(id, path);
}
