// The contract lens's card marks (issue #69): the badge rows drawn under every analysis card
// while the lens is active, plus the diagnostics ring class for the card frame. Like the runtime
// marks (issue #72) the rows are an absolute overlay OUTSIDE the LOD sizer: they never change the
// card's measured footprint, so positions and edge anchors hold (epic rule 2), and they stay
// visible at every LOD, counter-scaled through lodScreenPx (epic rule 4). The lens settings and
// the per-node diagnostics travel through context — a stable null while inactive keeps the cards
// subscription-free, the same pattern as RuntimeLensContext.

import { createContext, type CSSProperties, type ReactNode } from "react";
import type { Diagnostic } from "@facilis.dev/analyze";
import { lodScreenPx } from "@/facilis/graph-lod";
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

export interface ContractLensContextValue {
  /** Below CONTRACT_COMPACT_ZOOM the badges keep glyph+count only (epic rule 4). */
  readonly compact: boolean;
  /** True when the contract lens is the secondary one: the marks recede to 30% (epic rule 3). */
  readonly secondary: boolean;
  /** The one-to-one diagnostics join (issue #69); an absent id means no attached diagnostics. */
  readonly nodeDiagnostics: ReadonlyMap<string, readonly Diagnostic[]>;
}

/** null = lens inactive; the stable null keeps inactive cards free of re-renders. */
export const ContractLensContext = createContext<ContractLensContextValue | null>(null);

export interface ContractMarksProps {
  readonly compact: boolean;
  /** True when the contract lens is the secondary one: the marks recede to 30% (epic rule 3). */
  readonly secondary: boolean;
  /** A second lens row (issue #70's data marks) drawn under the contract row in the same stack. */
  readonly children?: ReactNode;
}

// The stack hangs below the card's unchanged footprint; pointer-events-none keeps drags, clicks
// and double-clicks reaching the card itself. Sizes counter-scale like the chip/compact content.
const STACK_STYLE: CSSProperties = { gap: lodScreenPx(3), marginTop: lodScreenPx(3) };
const ROW_STYLE: CSSProperties = { columnGap: lodScreenPx(4) };

/**
 * The one overlay stack under a card: a lens row per active meaning lens, so two lenses never
 * paint their rows on top of each other. Kept outside the LOD sizer so the card's measured
 * footprint and every node position hold (epic rule 2).
 */
export function CardMarksStack({ children }: { children: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 top-full flex flex-col items-start"
      style={STACK_STYLE}
    >
      {children}
    </div>
  );
}

function MarksRow({
  testId,
  secondary,
  children,
}: {
  testId: string;
  secondary: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-testid={testId}
      className={"flex flex-wrap items-center" + (secondary ? " opacity-30" : "")}
      style={ROW_STYLE}
    >
      {children}
    </div>
  );
}

export function RouteContractMarks({
  route,
  diagnostics,
  compact,
  secondary,
  children,
}: ContractMarksProps & { route: RouteGraphData; diagnostics: readonly Diagnostic[] }) {
  return (
    <CardMarksStack>
      <MarksRow testId="contract-marks-route" secondary={secondary}>
        <WrapperBadge wrapper={route.wrapper} compact={compact} />
        <InputBadge input={route.input} unknown={route.unknown} compact={compact} />
        <TablesBadge count={route.dbTables.length} unknown={route.unknown} compact={compact} />
        {route.elevations.length > 0 && (
          <ElevationsBadge elevations={route.elevations} compact={compact} />
        )}
        <DiagnosticsBadge diagnostics={diagnostics} compact={compact} />
      </MarksRow>
      {children}
    </CardMarksStack>
  );
}

export function TableContractMarks({
  table,
  diagnostics,
  compact,
  secondary,
  children,
}: ContractMarksProps & { table: TableGraphData; diagnostics: readonly Diagnostic[] }) {
  return (
    <CardMarksStack>
      <MarksRow testId="contract-marks-table" secondary={secondary}>
        <RlsBadge rlsEnabled={table.rlsEnabled} unknown={table.unknown} compact={compact} />
        <PoliciesBadge count={table.policies.length} unknown={table.unknown} compact={compact} />
        <DiagnosticsBadge diagnostics={diagnostics} compact={compact} />
      </MarksRow>
      {children}
    </CardMarksStack>
  );
}

export function ViewContractMarks({
  view,
  diagnostics,
  compact,
  secondary,
  children,
}: ContractMarksProps & { view: ViewGraphData; diagnostics: readonly Diagnostic[] }) {
  return (
    <CardMarksStack>
      <MarksRow testId="contract-marks-view" secondary={secondary}>
        <AccessBadge access={view.access} compact={compact} />
        {/* The permission is unreadable exactly when the access mode is (D-098): null access
            means the declared permission could not be read, so the badge hatches instead of
            guessing. */}
        <ViewPermissionBadge
          permission={view.permission}
          unknown={view.access === null}
          compact={compact}
        />
        <DiagnosticsBadge diagnostics={diagnostics} compact={compact} />
      </MarksRow>
      {children}
    </CardMarksStack>
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
    <CardMarksStack>
      <MarksRow testId="contract-marks-diagnostics" secondary={secondary}>
        <DiagnosticsBadge diagnostics={diagnostics} compact={compact} />
      </MarksRow>
    </CardMarksStack>
  );
}

/**
 * The card-frame ring for attached diagnostics: an outline, so it never fights the selection
 * ring (both name role tokens; error beats warning). The glyph+count badge inside the marks row
 * keeps the ring from being a colour-only signal (epic rule 6). nodeClass owns the single
 * outline channel: the AI focus outline (D-171) wins it when both apply, and the badge keeps
 * the severity visible on that card.
 */
export function contractRingClass(diagnostics: readonly Diagnostic[]): string {
  const severity = worstSeverity(diagnostics);
  if (severity === "error") return " outline outline-2 outline-offset-1 outline-destructive/70";
  if (severity === "warning") return " outline outline-2 outline-offset-1 outline-warning/70";
  return "";
}
