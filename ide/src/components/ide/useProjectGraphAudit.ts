// The contract lens's data wiring (issue #69): the one-to-one diagnostics join, the ribbon
// counters and the canvas's contract inputs, memoised against the analysis and the drawn view.
// Extracted from ProjectGraphPanel so the composition root stays under the 300-line source limit;
// the filter state itself lives in the URL-synced view state, not here.

import { useMemo } from "react";
import type { Analysis, Diagnostic } from "@facilis.dev/analyze";
import { buildNodeDiagnostics } from "@/facilis/graph-details";
import {
  contractLod,
  countAudit,
  toggleAuditFilter,
  type AuditCounts,
  type AuditFilterId,
} from "@/facilis/graph-contract";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { GraphViewState } from "@/facilis/graph-view-state";
import type { ProjectFlowContractState } from "./project-graph-flow-nodes";

export interface ProjectGraphAudit {
  readonly nodeDiagnostics: ReadonlyMap<string, readonly Diagnostic[]>;
  readonly counts: AuditCounts;
  readonly onToggle: (id: AuditFilterId) => void;
  readonly contract: ProjectFlowContractState;
}

export function useProjectGraphAudit(
  analysis: Analysis | null,
  view: ProjectGraphView | null,
  state: GraphViewState,
  setAuditFilters: (filters: readonly AuditFilterId[]) => void,
  zoom: number,
): ProjectGraphAudit {
  const nodeDiagnostics = useMemo(
    () =>
      analysis === null ? new Map<string, readonly Diagnostic[]>() : buildNodeDiagnostics(analysis),
    [analysis],
  );
  // The counters scan the drawn nodes, so they always equal what the canvas shows; the audit
  // filter dims but never removes, so pressing a counter does not change the counts.
  const counts = useMemo(
    () => countAudit(view?.nodes ?? [], nodeDiagnostics),
    [view, nodeDiagnostics],
  );
  const contract = useMemo<ProjectFlowContractState>(
    () => ({
      activeLenses: state.activeLenses,
      auditFilters: state.auditFilters,
      nodeDiagnostics,
      compactContract: contractLod(zoom) === "compact",
    }),
    [state.activeLenses, state.auditFilters, nodeDiagnostics, zoom],
  );
  const onToggle = (id: AuditFilterId) =>
    setAuditFilters(toggleAuditFilter(state.auditFilters, id));
  return { nodeDiagnostics, counts, onToggle, contract };
}
