// The project-graph table card: the schema object's columns, RLS class, declared grants and
// scope, plus the contract lens's RLS/policy badges and diagnostics ring (issue #69). Split from
// ProjectGraphNodes.tsx (which keeps page and workflow) so every card file stays under the
// 300-line source limit — the same pattern as the route and view cards. The LOD structure is
// unchanged: the full content stays the footprint sizer at every level (epic rule 2), and the
// lens marks hang outside it, counter-scaled (epic rule 4). Role tokens only (D-043/D-044).

import { useContext } from "react";
import type { NodeProps } from "@xyflow/react";
import ChevronDown from "~icons/lucide/chevron-down";
import ChevronRight from "~icons/lucide/chevron-right";
import Table2 from "~icons/lucide/table-2";
import { t, type MessageKey } from "@/i18n";
import type { ColumnMarker } from "@/facilis/graph-model";
import {
  ImpactTargetBadge,
  LinkHandles,
  NeverReadBadge,
  TurnBadge,
  UnknownBadge,
  nodeClass,
  turnSourceTitle,
} from "./ProjectGraphNodeChrome";
import {
  CardMarksStack,
  ContractLensContext,
  TableContractMarks,
  contractRingClass,
} from "./ProjectGraphContractMarks";
import { TableDataMarks } from "./ProjectGraphDataMarks";
import { GraphLodOverlay, ProjectGraphLodContent, lodSizerClass } from "./ProjectGraphLod";
import type { ProjectAnalysisFlowNode } from "./ProjectGraphNodes";
import { useGraphLod } from "./use-graph-lod";

const MAX_VISIBLE_COLUMNS = 8;

/** The card names at most two grants; the inspector's policy list carries the whole set (D-177). */
const MAX_VISIBLE_POLICIES = 2;

function ColumnMarkers({ markers }: { markers: readonly ColumnMarker[] }) {
  if (markers.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {markers.map((marker) => (
        <span key={marker} className="rounded border px-0.5 text-[10px] leading-tight">
          {t(("projectGraph.marker." + marker) as MessageKey)}
        </span>
      ))}
    </span>
  );
}

export function TableGraphNode({ data, selected, dragging }: NodeProps<ProjectAnalysisFlowNode>) {
  // The contract lens (issue #69) reads its settings from context, not node data: a stable null
  // while inactive means the card renders exactly as before, with no subscription.
  const contract = useContext(ContractLensContext);
  const level = useGraphLod();
  const node = data.node;
  const table = node.data.kind === "table" ? node.data : null;
  if (table === null) return null;
  const diagnostics = contract?.nodeDiagnostics.get(node.id) ?? [];
  const shown = data.collapsed ? [] : table.columns.slice(0, MAX_VISIBLE_COLUMNS);
  const more = table.columns.length - shown.length;
  // The restrictive tenant gate is the default class (D-136/D-174): the card names what the
  // table actually grants, which is the permissive policy beside it (D-177).
  const grants = table.policies.filter((policy) => !policy.restrictive);
  const shownPolicies = grants.slice(0, MAX_VISIBLE_POLICIES);
  return (
    <div
      data-testid="project-graph-table"
      data-lod={level}
      title={turnSourceTitle(node, data.turn)}
      className={
        nodeClass(
          selected,
          node.matched,
          dragging,
          data.focused,
          data.isolated,
          data.aiOutlined,
          data.auditDimmed,
          contract === null ? "" : contractRingClass(diagnostics),
          data.turn,
          data.impactDimmed,
        ) + " relative w-60"
      }
    >
      <div className={lodSizerClass(level)} aria-hidden={level !== "full"}>
        <div className="flex items-center gap-1.5">
          <Table2 className="size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium">
            {table.table}
          </span>
          {data.turn != null && <TurnBadge turn={data.turn} />}
          {table.unknown && <UnknownBadge />}
          {data.impactTarget && <ImpactTargetBadge secondary={data.impactSecondary} />}
          {data.neverRead && <NeverReadBadge secondary={data.impactSecondary} />}
          <button
            type="button"
            className="nodrag flex size-4 shrink-0 items-center justify-center rounded hover:bg-accent"
            aria-label={data.collapsed ? t("projectGraph.expand") : t("projectGraph.collapse")}
            title={data.collapsed ? t("projectGraph.expand") : t("projectGraph.collapse")}
            onClick={(event) => {
              event.stopPropagation();
              data.onToggleCollapse(node.id);
            }}
          >
            {data.collapsed ? (
              <ChevronRight className="size-3" />
            ) : (
              <ChevronDown className="size-3" />
            )}
          </button>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {/* RLS is the default class (D-136): the card names only the system-only exception. */}
          {!table.rlsEnabled && (
            <span className="rounded border border-border px-1 text-muted-foreground">
              {t("projectGraph.systemOnly")}
            </span>
          )}
          {shownPolicies.map((policy) => (
            <span
              key={policy.name}
              className="max-w-full truncate rounded border border-border px-1 font-mono"
              title={policy.name}
            >
              {policy.name}
            </span>
          ))}
          {grants.length > shownPolicies.length && (
            <span className="shrink-0">+{grants.length - shownPolicies.length}</span>
          )}
          {table.framework && (
            <span
              className="rounded border border-border px-1 text-muted-foreground"
              title={t("projectGraph.framework")}
            >
              {t("projectGraph.framework")}
            </span>
          )}
          {/* The tenant scope is the class default on every app table (D-136/D-174) and stays in the
            inspector; the card names only the exception, an owner scope. */}
          {table.scope !== null && table.scope.kind !== "tenant" && (
            <span className="min-w-0 truncate">
              {t("projectGraph.scope", {
                column: table.scope.column,
                kind: t(("projectGraph.scopeKind." + table.scope.kind) as MessageKey),
              })}
            </span>
          )}
          <span className="ml-auto shrink-0">
            {t("projectGraph.columns", { count: table.columns.length })}
          </span>
        </div>
        {shown.length > 0 && (
          <ul className="mt-1 space-y-0.5 border-t pt-1">
            {shown.map((column) => (
              <li key={column.property} className="flex items-center gap-1 text-[10px]">
                <span className="min-w-0 flex-1 truncate font-mono">{column.property}</span>
                <span className="shrink-0 truncate text-muted-foreground">{column.type}</span>
                <ColumnMarkers markers={column.markers} />
              </li>
            ))}
          </ul>
        )}
        {more > 0 && (
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            {t("projectGraph.moreColumns", { count: more })}
          </p>
        )}
      </div>
      {contract !== null ? (
        <TableContractMarks
          table={table}
          diagnostics={diagnostics}
          compact={contract.compact}
          secondary={contract.secondary}
        >
          {data.dataRole !== null && (
            <TableDataMarks
              table={table}
              compact={data.compactData}
              secondary={data.dataRole === "secondary"}
            />
          )}
        </TableContractMarks>
      ) : data.dataRole !== null ? (
        <CardMarksStack>
          <TableDataMarks
            table={table}
            compact={data.compactData}
            secondary={data.dataRole === "secondary"}
          />
        </CardMarksStack>
      ) : null}
      {level !== "full" && (
        <GraphLodOverlay>
          <ProjectGraphLodContent
            node={node}
            edgeCount={data.edgeCount}
            level={level}
            turn={data.turn}
            neverRead={data.neverRead}
          />
        </GraphLodOverlay>
      )}
      <LinkHandles />
    </div>
  );
}
