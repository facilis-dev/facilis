// The workspace frame (issue #212): title bar, shell branch and status bar in one element,
// so a covering layer can take the whole workspace out of the tab order and the
// accessibility tree with a single `inert` attribute. `inert` is a subtree flag, not a box,
// so the frame is display: contents and its three regions stay flex children of AppShell's
// root; Home and the bootstrap overlays are siblings outside the frame and stay usable.
import type { ReactNode } from "react";
import type { IdeSnapshot } from "@/vv/controller";

export function WorkspaceFrame({
  view,
  blockingLayerOpen,
  children,
}: {
  view: IdeSnapshot["view"];
  blockingLayerOpen: boolean;
  children: ReactNode;
}) {
  // React 19 takes the boolean attribute directly: true renders `inert`, false omits it.
  // Home registers too, but its registration lands in an effect: the view check keeps the
  // frame inert on Home's first commit and through its focus handoff.
  return (
    <div className="contents" data-workspace-frame="" inert={view === "home" || blockingLayerOpen}>
      {children}
    </div>
  );
}
