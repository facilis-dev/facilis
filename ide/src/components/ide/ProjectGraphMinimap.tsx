// The minimap (issue #68): the bottom-right HUD slot's density map — one rect per drawn card,
// coloured by kind with the shared semantic role tokens (project-graph-kind-tokens.ts, D-044),
// plus the current viewport rectangle. Click centres the view on the clicked world point;
// dragging pans it. Both drive the React Flow viewport ONLY (onPan → setViewport, onPanEnd →
// the viewport commit): node positions are never recomputed (epic #56 rule 2). The projection
// math is pure (graph-minimap.ts). Collapsed cards draw their real, smaller bounds; a #62
// cluster super-node is a node too, so it reads as a block with no special case once merged.
// Arrow keys pan when the surface is focused. Role tokens only; every string via t() (D-043).

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { t } from "@/i18n";
import type { GraphViewport } from "@/facilis/graph-layout-file";
import {
  MINIMAP_SIZE,
  centerOnWorldPoint,
  minimapBounds,
  minimapPanDelta,
  minimapProjection,
  minimapToWorld,
  minimapViewportRect,
  projectMinimapRect,
  type MinimapNode,
} from "@/facilis/graph-minimap";
import { panViewport } from "@/facilis/graph-navigation";
import { GRAPH_NODE_KIND_FILL } from "./project-graph-kind-tokens";

export interface ProjectGraphMinimapProps {
  readonly nodes: readonly MinimapNode[];
  readonly viewport: GraphViewport | null;
  /** The canvas container: its size turns the viewport into the visible-world rectangle. */
  readonly containerRef: RefObject<HTMLDivElement | null>;
  /** Live pan during a drag: the hook calls setViewport, never a layout setter. */
  readonly onPan: (viewport: GraphViewport) => void;
  /** Drag end / click / arrow key: commit the viewport (positions untouched). */
  readonly onPanEnd: (viewport: GraphViewport) => void;
}

/** Arrow-key pan step in screen pixels. */
const KEY_PAN_STEP = 40;
/** A #62 cluster frame sits behind its cards: a faint block, the cards keep the solid fill. */
const FRAME_OPACITY = 0.25;
/** Pre-measurement container fallback; the ResizeObserver replaces it on mount. */
const IDLE_CONTAINER = { width: 1024, height: 768 };

interface DragState {
  readonly startX: number;
  readonly startY: number;
  readonly origin: GraphViewport;
  current: GraphViewport;
  moved: boolean;
}

export function ProjectGraphMinimap({
  nodes,
  viewport,
  containerRef,
  onPan,
  onPanEnd,
}: ProjectGraphMinimapProps) {
  const [container, setContainer] = useState(IDLE_CONTAINER);
  const drag = useRef<DragState | null>(null);
  useEffect(() => {
    const element = containerRef.current;
    if (element === null) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0)
        setContainer({ width: rect.width, height: rect.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [containerRef]);

  const projection = useMemo(() => {
    const bounds = minimapBounds(nodes);
    return bounds === null ? null : minimapProjection(bounds);
  }, [nodes]);
  if (projection === null || viewport === null) return null;

  const viewportRect = minimapViewportRect(viewport, container, projection);
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      origin: viewport,
      current: viewport,
      moved: false,
    };
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const state = drag.current;
    if (state === null) return;
    const delta = { x: event.clientX - state.startX, y: event.clientY - state.startY };
    if (Math.abs(delta.x) + Math.abs(delta.y) > 3) state.moved = true;
    if (!state.moved) return;
    const pan = minimapPanDelta(delta, projection, state.origin.zoom);
    state.current = panViewport(state.origin, pan);
    onPan(state.current);
  };
  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const state = drag.current;
    drag.current = null;
    if (state === null) return;
    if (state.moved) {
      onPanEnd(state.current);
      return;
    }
    // A press without a drag is a click: centre on the clicked world point.
    const rect = event.currentTarget.getBoundingClientRect();
    const world = minimapToWorld(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      projection,
    );
    const next = centerOnWorldPoint(world, viewport.zoom, container);
    onPan(next);
    onPanEnd(next);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, { x: number; y: number }> = {
      ArrowLeft: { x: KEY_PAN_STEP, y: 0 },
      ArrowRight: { x: -KEY_PAN_STEP, y: 0 },
      ArrowUp: { x: 0, y: KEY_PAN_STEP },
      ArrowDown: { x: 0, y: -KEY_PAN_STEP },
    };
    const step = steps[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = panViewport(viewport, step);
    onPan(next);
    onPanEnd(next);
  };

  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={t("projectGraph.minimap.label")}
      title={t("projectGraph.minimap.keyboardHint")}
      data-testid="graph-minimap"
      onKeyDown={onKeyDown}
      className="cursor-pointer touch-none rounded border border-border bg-background/95 outline-none focus:ring-1 focus:ring-ring"
    >
      <svg
        width={MINIMAP_SIZE.width}
        height={MINIMAP_SIZE.height}
        viewBox={`0 0 ${MINIMAP_SIZE.width} ${MINIMAP_SIZE.height}`}
        aria-hidden="true"
        className="block"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {nodes.map((node) => {
          const rect = projectMinimapRect(node, projection);
          return (
            <rect
              key={node.id}
              data-testid={"graph-minimap-node-" + node.id}
              x={rect.x}
              y={rect.y}
              width={Math.max(2, rect.width)}
              height={Math.max(2, rect.height)}
              rx={1}
              fill={GRAPH_NODE_KIND_FILL[node.kind]}
              fillOpacity={node.kind === "cluster" ? FRAME_OPACITY : 0.85}
            />
          );
        })}
        <rect
          data-testid="graph-minimap-viewport"
          x={viewportRect.x}
          y={viewportRect.y}
          width={viewportRect.width}
          height={viewportRect.height}
          fill="var(--primary)"
          fillOpacity={0.12}
          stroke="var(--primary)"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
}
