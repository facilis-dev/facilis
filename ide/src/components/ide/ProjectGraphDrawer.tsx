// The floating inspector drawer (D-211, issues #187/#191): dismissible, overlaying the canvas
// instead of stealing a permanent column. Wide viewports keep the right column; narrow ones turn
// it into a bottom sheet that reserves its height in fit/centre, scrolls its content and clears
// the device safe area. X (inside the inspector header), Esc and a pointer-down outside all close
// it; the camera reserves its footprint separately (safe-area.ts).

import { useEffect, useRef, type ReactNode } from "react";
import { t } from "@/i18n";
import { useNarrowViewport } from "./use-narrow-viewport";

const SIDE_CLASS =
  "absolute right-2 top-12 bottom-2 z-20 flex w-80 max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-lg border bg-sidebar shadow-xl";
const SHEET_CLASS =
  "absolute inset-x-2 bottom-2 z-20 flex h-[60%] max-h-[360px] flex-col overflow-hidden rounded-t-lg border bg-sidebar pb-[env(safe-area-inset-bottom)] shadow-xl";

export function ProjectGraphDrawer({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const sheet = useNarrowViewport();
  // Capture pointer-down so a click on the canvas closes the drawer before the canvas reacts;
  // selecting another node opens it again through the panel's selection handler.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const drawer = ref.current;
      if (drawer !== null && !drawer.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose]);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t("projectGraph.drawer")}
      data-testid="project-graph-drawer"
      data-layout={sheet ? "sheet" : "side"}
      className={sheet ? SHEET_CLASS : SIDE_CLASS}
    >
      {children}
    </div>
  );
}
