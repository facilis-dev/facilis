// The full-bleed graph shell (issue #57): a relative container the canvas fills edge to edge,
// with the HUD and the inspector stacked over it as absolutely-positioned overlays. Nothing here
// participates in the canvas's layout, so selecting a node or showing the HUD never resizes it.
// The container ref is the measurement origin for useHudFitPadding (HUD rects are read against it).

import type { ReactNode, RefObject } from "react";
import { t } from "@/i18n";

export function ProjectGraphShell({
  containerRef,
  children,
  hud,
  inspector,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  /** The canvas, or the no-project/loading/error/empty state view. */
  children: ReactNode;
  /** The floating HUD overlay, or null in zen mode. */
  hud: ReactNode | null;
  /** The selected-node inspector overlay, or null when nothing is selected. */
  inspector: ReactNode | null;
}) {
  return (
    <section
      ref={containerRef}
      data-testid="project-graph-panel"
      aria-label={t("projectGraph.title")}
      className="relative h-full min-h-0 overflow-hidden bg-editor"
    >
      <div className="absolute inset-0">{children}</div>
      {hud}
      {inspector}
    </section>
  );
}
