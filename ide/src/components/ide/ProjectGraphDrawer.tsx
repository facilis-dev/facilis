// The floating right drawer (D-211, issue #187): the inspector is dismissible and overlays the
// canvas instead of stealing a permanent column. X (inside the inspector header), Esc and a
// pointer-down outside all close it; the camera reserves its width separately (safe-area.ts).

import { useEffect, useRef, type ReactNode } from "react";
import { t } from "@/i18n";

export function ProjectGraphDrawer({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
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
      className="absolute right-2 top-12 bottom-2 z-20 flex w-80 max-w-[calc(100%-1rem)] flex-col overflow-hidden rounded-lg border bg-sidebar shadow-xl"
    >
      {children}
    </div>
  );
}
