// The bottom sheet (issue #59): below SHEET_BREAKPOINT the details render here instead of the
// in-canvas satellite — still an overlay, never a layout sibling, so the canvas keeps its rect.
// In matrix mode (issue #67, F.7) it is the details overlay at ALL widths: there is no canvas,
// so there is no satellite to place.
// The drag handle resizes the sheet within the canvas (session state); the body is the same
// inspector the satellite uses. Esc closes and returns focus to the selected card.

import { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { t } from "@/i18n";
import type { ProjectGraphEdge, ProjectGraphNode } from "@/facilis/graph-model";
import type { NodeDetails } from "@/facilis/graph-details";
import { ProjectGraphInspector } from "./ProjectGraphInspector";
import { useDetailsDialog } from "./use-details-dialog";

const HANDLE_STEP = 24;

export interface ProjectGraphDetailsSheetProps {
  node: ProjectGraphNode;
  edges: readonly ProjectGraphEdge[];
  details: NodeDetails | null;
  sources: ReadonlyMap<string, string>;
  nodeLabel: (id: string) => string | null;
  height: number;
  pinned: boolean;
  /** False in matrix mode (issue #67, F.7): the sheet is the only details surface, no canvas. */
  canPin?: boolean;
  onHeightChange: (height: number) => void;
  onClose: () => void;
  onTogglePin: () => void;
  onOpenFileAt: (file: string, line: number) => void;
  onOpenPreview: (path: string) => void;
  onSelectNode: (id: string) => void;
}

export function ProjectGraphDetailsSheet({
  node,
  edges,
  details,
  sources,
  nodeLabel,
  height,
  pinned,
  canPin = true,
  onHeightChange,
  onClose,
  onTogglePin,
  onOpenFileAt,
  onOpenPreview,
  onSelectNode,
}: ProjectGraphDetailsSheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = useDetailsDialog(ref, onClose);
  const drag = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);

  const onHandlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height };
  };
  const onHandlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (state === null || state.pointerId !== event.pointerId) return;
    onHeightChange(state.startHeight + (state.startY - event.clientY));
  };
  const onHandlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };
  const onHandleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    event.stopPropagation();
    onHeightChange(height + (event.key === "ArrowUp" ? HANDLE_STEP : -HANDLE_STEP));
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t("projectGraph.details")}
      data-testid="project-graph-details-sheet"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="absolute inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden border-t border-border bg-sidebar shadow-lg"
      style={{ height }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("projectGraph.detailsSheetHandle")}
        tabIndex={0}
        className="flex h-4 shrink-0 cursor-row-resize touch-none items-center justify-center"
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
        onKeyDown={onHandleKeyDown}
      >
        <span className="h-1 w-10 rounded-full bg-muted-foreground/40" />
      </div>
      <div className="min-h-0 flex-1">
        <ProjectGraphInspector
          node={node}
          edges={edges}
          details={details}
          sources={sources}
          nodeLabel={nodeLabel}
          pinned={pinned}
          canPin={canPin}
          fill
          onClose={onClose}
          onTogglePin={onTogglePin}
          onOpenFileAt={onOpenFileAt}
          onOpenPreview={onOpenPreview}
          onSelectNode={onSelectNode}
        />
      </div>
    </div>
  );
}
