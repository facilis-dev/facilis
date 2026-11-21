// The impact lens's derived state (issue #74): the simulation overlay, the HUD line and the
// satellite section are pure functions of (displayView, addressable state, details join), so
// exiting the lens restores the exact previous rendering inputs (criterion 5) and a shared URL
// lands on the same simulation. Kept out of the panel so that file stays under the 300-line
// source limit. Nothing here writes the model: the lens only changes colour/badges/dimming.

import { useCallback, useEffect, useMemo } from "react";
import type { HttpMethod } from "@facilis.dev/analyze";
import type { NodeDetails } from "@/facilis/graph-details";
import {
  columnFactsFromDetails,
  computeColumnImpact,
  computeRemovalImpact,
  impactOverlay,
  tableColumnFactsExist,
  type AnalysedColumnImpact,
  type ColumnImpact,
  type ImpactOverlay,
  type RemovalImpact,
} from "@/facilis/graph-impact";
import { activateLens } from "@/facilis/graph-lens-state";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { ProjectGraphViewState } from "./useProjectGraphViewState";

/** Canonical HTTP-method order for the satellite's grouped route list. */
const METHOD_ORDER: readonly HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "TRACE",
  "CONNECT",
  "ALL",
];

export interface ImpactRouteGroup {
  readonly method: HttpMethod;
  readonly routes: readonly { readonly id: string; readonly label: string }[];
}

/** What the satellite's impact section renders and drives (table/view selections only). */
export interface ImpactSatellite {
  readonly active: boolean;
  /** The simulated result whose routes the list shows; null when nothing is simulated. */
  readonly result: RemovalImpact | AnalysedColumnImpact | null;
  readonly columnImpact: ColumnImpact | null;
  /** Whether the selected table has any column facts at all (the honest-unknown gate). */
  readonly columnAnalysed: boolean;
  readonly impactColumn: string | null;
  readonly routeGroups: readonly ImpactRouteGroup[];
  readonly onToggle: () => void;
  readonly onSimulateColumn: (property: string | null) => void;
}

export interface ImpactHud {
  readonly active: boolean;
  readonly counts: { readonly routes: number; readonly views: number } | null;
  /** Lens active but nothing suitable selected: the "select a table" hint replaces counts. */
  readonly hint: boolean;
  readonly columnNotAnalysed: boolean;
}

export interface ProjectGraphImpact {
  readonly lensActive: boolean;
  /** The canvas overlay; null when the lens is inactive (the previous picture returns). */
  readonly overlay: ImpactOverlay | null;
  readonly satellite: ImpactSatellite;
  readonly hud: ImpactHud;
  /** Esc / the exit button: removes ONLY the impact lens and its column. */
  readonly exit: () => void;
}

export function useProjectGraphImpact(
  viewState: ProjectGraphViewState,
  view: ProjectGraphView | null,
  details: ReadonlyMap<string, NodeDetails>,
): ProjectGraphImpact {
  const { state, setActiveLenses, setImpactColumn } = viewState;
  const lensActive = state.activeLenses.includes("impact");
  // Memoized so the overlay keeps a stable identity across unrelated panel re-renders: the
  // canvas rebuilds its cards only when the simulation actually changes.
  const selectedNode = useMemo(
    () => view?.nodes.find((node) => node.id === state.selection) ?? null,
    [view, state.selection],
  );
  const tableNode = selectedNode !== null && selectedNode.data.kind === "table" ? selectedNode : null;
  const facts = useMemo(() => columnFactsFromDetails(details), [details]);

  const removal = useMemo(
    () =>
      lensActive && view !== null && selectedNode !== null
        ? computeRemovalImpact(view, selectedNode.id)
        : null,
    [lensActive, view, selectedNode],
  );
  // The validated column: a stale property (another table, an analysis refresh) reads as null
  // here and the effect below drops it from the URL state as well.
  const impactColumn =
    lensActive &&
    tableNode !== null &&
    tableNode.data.kind === "table" &&
    state.impactColumn !== null &&
    tableNode.data.columns.some((column) => column.property === state.impactColumn)
      ? state.impactColumn
      : null;
  const columnImpact = useMemo(
    () =>
      lensActive && view !== null && tableNode !== null && impactColumn !== null
        ? computeColumnImpact(view, tableNode.id, impactColumn, facts)
        : null,
    [lensActive, view, tableNode, impactColumn, facts],
  );
  const columnAnalysed = useMemo(
    () =>
      view !== null && tableNode !== null && tableColumnFactsExist(view, tableNode.id, facts),
    [view, tableNode, facts],
  );
  // A selected column owns the simulation: an unanalysed column dims nothing (honest unknown).
  const activeResult: RemovalImpact | AnalysedColumnImpact | null =
    impactColumn !== null
      ? columnImpact !== null && columnImpact.analysed
        ? columnImpact
        : null
      : removal;
  const overlay = useMemo(
    () => (lensActive && view !== null ? impactOverlay(view, activeResult) : null),
    [lensActive, view, activeResult],
  );

  useEffect(() => {
    if (state.impactColumn !== null && impactColumn === null) setImpactColumn(null);
  }, [state.impactColumn, impactColumn, setImpactColumn]);

  const exit = useCallback(() => {
    setActiveLenses(state.activeLenses.filter((lens) => lens !== "impact"));
    setImpactColumn(null);
  }, [state.activeLenses, setActiveLenses, setImpactColumn]);

  const onToggle = useCallback(() => {
    if (lensActive) {
      exit();
      return;
    }
    const next = activateLens(state.activeLenses, "impact");
    // A third lens is refused (epic rule 3), exactly like the chip: the state stays unchanged.
    if (!next.refused) setActiveLenses(next.lenses);
  }, [lensActive, exit, state.activeLenses, setActiveLenses]);

  const onSimulateColumn = useCallback(
    (property: string | null) => {
      if (property === null) {
        setImpactColumn(null);
        return;
      }
      if (!lensActive) {
        const next = activateLens(state.activeLenses, "impact");
        if (next.refused) return;
        setActiveLenses(next.lenses);
      }
      setImpactColumn(property);
    },
    [lensActive, state.activeLenses, setActiveLenses, setImpactColumn],
  );

  const routeGroups = useMemo(() => {
    if (view === null || activeResult === null) return [];
    const affected = new Set(activeResult.affectedNodeIds);
    const groups = new Map<HttpMethod, { id: string; label: string }[]>();
    for (const node of view.nodes) {
      if (node.kind !== "route" || node.data.kind !== "route" || !affected.has(node.id)) continue;
      const list = groups.get(node.data.method) ?? [];
      list.push({ id: node.id, label: node.label });
      groups.set(node.data.method, list);
    }
    return METHOD_ORDER.filter((method) => groups.has(method)).map((method) => ({
      method,
      routes: (groups.get(method) ?? []).toSorted((a, b) => a.label.localeCompare(b.label)),
    }));
  }, [view, activeResult]);

  return {
    lensActive,
    overlay,
    satellite: {
      active: lensActive,
      result: activeResult,
      columnImpact,
      columnAnalysed,
      impactColumn,
      routeGroups,
      onToggle,
      onSimulateColumn,
    },
    hud: {
      active: lensActive,
      counts: activeResult?.counts ?? null,
      hint: lensActive && activeResult === null && impactColumn === null,
      columnNotAnalysed: lensActive && impactColumn !== null && columnImpact?.analysed === false,
    },
    exit,
  };
}
