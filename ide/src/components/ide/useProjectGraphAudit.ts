// The contract lens's data wiring (issue #69): the one-to-one diagnostics join, the ribbon
// counters, the canvas's dimming inputs and the marks' context value, memoised against the
// analysis and the drawn view. Extracted from ProjectGraphPanel so the composition root stays
// under the 300-line source limit; the filter state itself lives in the URL-synced view state.
// The context follows the runtime lens pattern (issue #72): a stable null while the lens is
// inactive keeps every card subscription-free, and it is memoised on the derived booleans, not
// on zoom, so a pan/zoom only re-renders the marks when the LOD crosses the threshold.

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
import { lensRole } from "@/facilis/graph-lens-state";
import type { ProjectGraphView } from "@/facilis/graph-model";
import type { ContractLensContextValue } from "./ProjectGraphContractMarks";
import type { ProjectFlowContractState } from "./project-graph-flow-nodes";
import type { ProjectGraphViewState } from "./useProjectGraphViewState";

export interface ProjectGraphAudit {
  readonly nodeDiagnostics: ReadonlyMap<string, readonly Diagnostic[]>;
  readonly counts: AuditCounts;
  readonly onToggle: (id: AuditFilterId) => void;
  /** The flow mapper's dimming inputs; the badges read the context instead. */
  readonly contract: ProjectFlowContractState;
  /** null while the lens is inactive: the stable null keeps card renders untouched. */
  readonly context: ContractLensContextValue | null;
  /** The HUD's diagnostic totals (all severities, not only the attached ones). */
  readonly errors: number;
  readonly warnings: number;
}

export function useProjectGraphAudit(
  analysis: Analysis | null,
  view: ProjectGraphView | null,
  viewState: ProjectGraphViewState,
  zoom: number,
): ProjectGraphAudit {
  const state = viewState.state;
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
    () => ({ auditFilters: state.auditFilters, nodeDiagnostics }),
    [state.auditFilters, nodeDiagnostics],
  );
  const active = state.activeLenses.includes("contract");
  const compact = contractLod(zoom) === "compact";
  const secondary = lensRole(state.activeLenses, "contract") === "secondary";
  const context = useMemo<ContractLensContextValue | null>(
    () => (active ? { compact, secondary, nodeDiagnostics } : null),
    [active, compact, secondary, nodeDiagnostics],
  );
  const errors = analysis?.diagnostics.filter((entry) => entry.severity === "error").length ?? 0;
  const warnings =
    analysis?.diagnostics.filter((entry) => entry.severity === "warning").length ?? 0;
  const onToggle = (id: AuditFilterId) =>
    viewState.setAuditFilters(toggleAuditFilter(state.auditFilters, id));
  return { nodeDiagnostics, counts, onToggle, contract, context, errors, warnings };
}
