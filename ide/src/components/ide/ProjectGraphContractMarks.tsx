// The contract lens's per-kind card layer (issue #69): which badges a route, table or view card
// draws while the lens is active, plus the diagnostics ring for the card frame. A secondary lens
// draws the marks at 30% (epic rule 3); the compact LOD is handled inside each badge. The marks
// only add a row to the card — the card's position never changes (epic rule 2).

import type { Diagnostic } from "@facilis.dev/analyze";
import type { RouteGraphData, TableGraphData, ViewGraphData } from "@/facilis/graph-types";
import { worstSeverity } from "@/facilis/graph-diagnostics";
import {
  DiagnosticsBadge,
  ElevationsBadge,
  InputBadge,
  TablesBadge,
  WrapperBadge,
} from "./ProjectGraphContractBadges";
import {
  AccessBadge,
  PoliciesBadge,
  RlsBadge,
  ViewPermissionBadge,
} from "./ProjectGraphSchemaContractBadges";

export interface ContractMarksProps {
  readonly compact: boolean;
  /** True when the contract lens is the secondary one: the marks recede to 30% (epic rule 3). */
  readonly secondary: boolean;
}

function marksClass(secondary: boolean): string {
  return "mt-1 flex flex-wrap items-center gap-1 border-t pt-1" + (secondary ? " opacity-30" : "");
}

export function RouteContractMarks({
  route,
  diagnostics,
  compact,
  secondary,
}: ContractMarksProps & { route: RouteGraphData; diagnostics: readonly Diagnostic[] }) {
  return (
    <div data-testid="contract-marks-route" className={marksClass(secondary)}>
      <WrapperBadge wrapper={route.wrapper} compact={compact} />
      <InputBadge input={route.input} unknown={route.unknown} compact={compact} />
      <TablesBadge count={route.dbTables.length} unknown={route.unknown} compact={compact} />
      {route.elevations.length > 0 && (
        <ElevationsBadge elevations={route.elevations} compact={compact} />
      )}
      <DiagnosticsBadge diagnostics={diagnostics} compact={compact} />
    </div>
  );
}

export function TableContractMarks({
  table,
  diagnostics,
  compact,
  secondary,
}: ContractMarksProps & { table: TableGraphData; diagnostics: readonly Diagnostic[] }) {
  return (
    <div data-testid="contract-marks-table" className={marksClass(secondary)}>
      <RlsBadge rlsEnabled={table.rlsEnabled} unknown={table.unknown} compact={compact} />
      <PoliciesBadge count={table.policies.length} unknown={table.unknown} compact={compact} />
      <DiagnosticsBadge diagnostics={diagnostics} compact={compact} />
    </div>
  );
}

export function ViewContractMarks({
  view,
  diagnostics,
  compact,
  secondary,
}: ContractMarksProps & { view: ViewGraphData; diagnostics: readonly Diagnostic[] }) {
  return (
    <div data-testid="contract-marks-view" className={marksClass(secondary)}>
      <AccessBadge access={view.access} compact={compact} />
      {/* The permission is unreadable exactly when the access mode is (D-098): null access means
          the declared permission could not be read, so the badge hatches instead of guessing. */}
      <ViewPermissionBadge
        permission={view.permission}
        unknown={view.access === null}
        compact={compact}
      />
      <DiagnosticsBadge diagnostics={diagnostics} compact={compact} />
    </div>
  );
}

/** Pages and workflows have no contract facts of their own — only attached diagnostics. */
export function NodeDiagnosticsMarks({
  diagnostics,
  compact,
  secondary,
}: ContractMarksProps & { diagnostics: readonly Diagnostic[] }) {
  if (diagnostics.length === 0) return null;
  return (
    <div data-testid="contract-marks-diagnostics" className={marksClass(secondary)}>
      <DiagnosticsBadge diagnostics={diagnostics} compact={compact} />
    </div>
  );
}

/**
 * The card-frame ring for attached diagnostics: an outline, so it never fights the selection
 * ring (both name role tokens; error beats warning). The glyph+count badge inside the card keeps
 * the ring from being a colour-only signal (epic rule 6).
 */
export function contractRingClass(diagnostics: readonly Diagnostic[]): string {
  const severity = worstSeverity(diagnostics);
  if (severity === "error") return " outline outline-2 outline-offset-1 outline-destructive/70";
  if (severity === "warning") return " outline outline-2 outline-offset-1 outline-warning/70";
  return "";
}
