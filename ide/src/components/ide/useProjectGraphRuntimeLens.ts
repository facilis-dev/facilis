// The runtime lens's React wiring (issue #72): active iff the view state's lenses include
// "runtime". The lifecycle itself lives in graph-runtime-session.ts (unit-testable without
// React); this hook only binds it to the view state and derives the context value the card
// marks read. Extracted from ProjectGraphPanel so the composition root stays under the
// 300-line source limit, the useProjectGraphAudit pattern (#69).
//
// Activation enables the #71 seam with the drawn view's route templates; a route-set change
// (analysis refresh) re-enables cleanly. Live on adds the repaint subscription + 1 s tick,
// live off removes both. Deactivation/unmount drops everything (the session's leak check).
// A null session (no kernel token) keeps the lens in the empty state — never a throw.

import { useEffect, useMemo, useRef } from "react";
import { lensRole } from "@/facilis/graph-lens-state";
import { routeTemplatesOf, runtimeLod, type RuntimeWindow } from "@/facilis/graph-runtime";
import { createRuntimeLensSession, type RuntimeLensSession } from "@/facilis/graph-runtime-session";
import { runtimeMetricsSession } from "@/facilis/runtime-metrics-wire";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { IdeController } from "@/vv/controller";
import type { ProjectGraphViewState } from "./useProjectGraphViewState";
import type { RuntimeLensContextValue } from "./ProjectGraphRuntimeMarks";

export interface ProjectGraphRuntimeLens {
  /** null while the lens is inactive: the stable null keeps card renders untouched. */
  readonly context: RuntimeLensContextValue | null;
  readonly window: RuntimeWindow;
  readonly live: boolean;
  readonly setWindow: (window: RuntimeWindow) => void;
  readonly setLive: (live: boolean) => void;
  /** The inspector's runtime section input; null when the lens is inactive. */
  readonly details: { readonly window: RuntimeWindow } | null;
}

export function useProjectGraphRuntimeLens(
  controller: IdeController,
  view: ProjectGraphView | null,
  viewState: ProjectGraphViewState,
  zoom: number,
): ProjectGraphRuntimeLens {
  const state = viewState.state;
  const active = state.activeLenses.includes("runtime");
  const window = state.runtimeWindow;
  const live = state.runtimeLive;
  // The enable list is keyed by content, not view identity: a query keystroke rebuilds the
  // view but must not churn the seam while the route set is unchanged.
  const routeKey = useMemo(() => routeTemplatesOf(view?.nodes ?? []).join("\u0000"), [view]);
  const sessionRef = useRef<RuntimeLensSession | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    if (!active) return;
    const templates = routeKey === "" ? [] : routeKey.split("\u0000");
    const session = createRuntimeLensSession(() =>
      runtimeMetricsSession(controller.bridge, controller.preview),
    );
    session.activate(templates, liveRef.current);
    sessionRef.current = session;
    return () => {
      session.deactivate();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [active, routeKey, controller]);

  useEffect(() => {
    if (active) sessionRef.current?.setLive(live);
  }, [active, live]);

  const detailed = runtimeLod(zoom) === "detailed";
  const secondary = lensRole(state.activeLenses, "runtime") === "secondary";
  // Memoised on the derived booleans, not zoom: a pan/zoom only re-renders the marks when
  // the LOD actually crosses the threshold.
  const context = useMemo<RuntimeLensContextValue | null>(
    () => (active ? { window, detailed, secondary } : null),
    [active, window, detailed, secondary],
  );

  return {
    context,
    window,
    live,
    setWindow: viewState.setRuntimeWindow,
    setLive: viewState.setRuntimeLive,
    details: active ? { window } : null,
  };
}
