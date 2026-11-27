// The project graph's lens state (D-220, #189; registry and lifecycle #198; runtime lens
// #199), split from the panel to keep both under the 300-line source limit. Lenses are draw
// state only: opening one activates its source through the lifecycle, so a live source runs
// only while somebody is watching (D-224 §4). Static lenses never leave this hook's memoized
// filter.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Analysis, GraphDiagnostic, GraphDiagnosticCode } from "@facilis.dev/analyze";
import type { ProjectGraphView } from "@/facilis/graph-model";
import {
  createGraphLensLifecycle,
  type GraphLensAvailability,
  type GraphLensSourceAdapter,
} from "@/facilis/graph-surface/lens-lifecycle.ts";
import {
  createChangesLensSource,
  type ChangesLensController,
} from "@/facilis/graph-surface/changes-lens-source.ts";
import {
  createRuntimeLensSource,
  type RuntimeLensController,
} from "@/facilis/graph-surface/runtime-lens-source.ts";
import { lensDefinition } from "@/facilis/graph-surface/lenses-registry.ts";
import { subscribeGraphLensRequests } from "@/facilis/graph-surface/lens-request.ts";
import { buildPrerenderLensState } from "@/facilis/graph-surface/prerender-lens.ts";
import { buildReachLensState, defaultReachRole } from "@/facilis/graph-surface/reach-lens.ts";
import {
  diagnosticsByNode,
  lensHighlight,
  summarizeLens,
  type GraphLensHighlight,
  type GraphLensId,
} from "@/facilis/graph-surface/lenses.ts";
import type { GraphLensState, GraphLensView } from "@/facilis/graph-surface/state-facts.ts";

const NO_DIAGNOSTICS: readonly GraphDiagnostic[] = [];

/** The controller surface both live/workspace sources read. */
export interface GraphLensController extends RuntimeLensController, ChangesLensController {}

interface LensSelection {
  readonly lens: GraphLensId;
  /** The project the lens was opened on: a state lens never leaks across projects. */
  readonly projectKey: string | null;
}

export interface ProjectGraphLensState {
  readonly lens: GraphLensId | null;
  readonly view: GraphLensView | null;
  readonly highlight: GraphLensHighlight | null;
  readonly byNode: ReadonlyMap<string, readonly GraphDiagnostic[]>;
  readonly availabilityOf: (lens: GraphLensId) => GraphLensAvailability;
  readonly selectLens: (lens: GraphLensId) => void;
  readonly closeLens: () => void;
}

export function useProjectGraphLens(
  analysis: Analysis | null,
  view: ProjectGraphView | null,
  projectKey: string | null = null,
  controller: GraphLensController | null = null,
): ProjectGraphLensState {
  const diagnostics = analysis?.graphDiagnostics;
  const config = analysis?.config ?? null;
  const adapters = useMemo<readonly GraphLensSourceAdapter[]>(
    () =>
      controller === null
        ? []
        : [createRuntimeLensSource(controller), createChangesLensSource(controller)],
    [controller],
  );
  const lifecycle = useMemo(() => createGraphLensLifecycle(adapters), [adapters]);
  const [selection, setSelection] = useState<LensSelection | null>(null);
  // The reach lens's role choice: null means "the config's default", re-resolved each render.
  const [role, setRole] = useState<string | null>(null);
  // Derived, not reset in an effect: changing project closes the lens in the same render, so no
  // frame ever shows the previous project's source or summary.
  const lens = selection !== null && selection.projectKey === projectKey ? selection.lens : null;
  // ...and the selection itself is dropped, so returning to the previous project does not revive
  // a lens whose buffer was already dropped on deactivation.
  useEffect(() => {
    setSelection(null);
    setRole(null);
  }, [projectKey]);
  useEffect(() => {
    lifecycle.apply(lens, { view });
  }, [lifecycle, lens, view]);
  useEffect(() => () => lifecycle.dispose(), [lifecycle]);
  // A live source notifies when a batch lands: pull its window into state, so a repaint sees
  // fresh numbers and a static lens never re-renders for a source it does not have.
  const [state, setState] = useState<GraphLensState | null>(null);
  useEffect(() => {
    if (lens === null) {
      setState(null);
      return undefined;
    }
    const refresh = (): void => setState(lifecycle.stateOf(lens, { view }));
    refresh();
    return lifecycle.subscribe(lens, refresh);
  }, [lifecycle, lens, view]);
  // A lens answer must be navigable: keep only nodes the current view actually draws.
  const facts = useMemo(() => {
    if (diagnostics === undefined || view === null) return NO_DIAGNOSTICS;
    const visible = new Set(view.nodes.map((node) => node.id));
    return diagnostics.filter((entry) => visible.has(entry.nodeId));
  }, [diagnostics, view]);
  const byNode = useMemo(() => diagnosticsByNode(facts), [facts]);
  const definition = lens === null ? null : lensDefinition(lens);
  const summary = useMemo(
    () => (lens === null || definition?.source !== "static" ? null : summarizeLens(lens, facts)),
    [lens, definition, facts],
  );
  // A declared lens (reach) reads config facts the panel already holds: no adapter to enable.
  const selectedRole = useMemo(() => {
    if (config === null) return null;
    return role !== null && config.roles[role] !== undefined ? role : defaultReachRole(config);
  }, [config, role]);
  const reach = useMemo(
    () => (lens === "reach" ? buildReachLensState(config, view, selectedRole, setRole) : null),
    [lens, config, view, selectedRole],
  );
  const prerender = useMemo(
    () => (lens === "prerender" ? buildPrerenderLensState(analysis?.prerender ?? [], view) : null),
    [lens, analysis, view],
  );
  const lensView = useMemo<GraphLensView | null>(() => {
    if (lens === null) return null;
    if (summary !== null) return { kind: "diagnostics", summary };
    if (reach !== null) return { kind: "state", state: reach };
    if (prerender !== null) return { kind: "state", state: prerender };
    return state === null ? null : { kind: "state", state };
  }, [lens, summary, reach, prerender, state]);
  const highlight = useMemo<GraphLensHighlight | null>(() => {
    if (lensView === null) return null;
    if (lensView.kind === "diagnostics") return lensHighlight(lensView.summary);
    const flagged =
      lensView.state.highlight === undefined
        ? new Set(lensView.state.badges.keys())
        : new Set(lensView.state.highlight);
    return {
      flagged,
      codeOf: new Map<string, GraphDiagnosticCode>(),
      badges: lensView.state.badges,
    };
  }, [lensView]);
  const selectLens = useCallback(
    (next: GraphLensId) => {
      setSelection((current) =>
        current !== null && current.lens === next && current.projectKey === projectKey
          ? null
          : { lens: next, projectKey },
      );
    },
    [projectKey],
  );
  const closeLens = useCallback(() => setSelection(null), []);
  // Palette and picker requests use the chip's own toggle, so lifecycle and availability stay
  // in one place; a request made while the panel was closed is replayed on mount.
  useEffect(() => subscribeGraphLensRequests(selectLens), [selectLens]);
  return {
    lens,
    view: lensView,
    highlight,
    byNode,
    availabilityOf: lifecycle.availabilityOf,
    selectLens,
    closeLens,
  };
}
