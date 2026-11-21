// The contract lens's route badges and the shared badge primitive (issue #69): one badge per
// contract fact, each carrying a glyph AND a label or tooltip — never colour alone (epic rule 6).
// An unknown fact renders as a hatched ring, visually distinct from both "ok" and "absent" (epic
// rule 5): the hatch derives from currentColor, a role token, so both themes keep the pattern
// (D-044). Every size counter-scales through lodScreenPx like the other lens marks (issue #60):
// the text stays at 9 SCREEN px wherever the badges draw, never below the 7px floor (epic rule
// 4). At compact zoom the badges drop their words and keep glyph+count, the full label staying
// in the title. The schema-object badges live in ProjectGraphSchemaContractBadges.tsx so both
// files stay under the 300-line source limit.

import type { CSSProperties, ReactNode } from "react";
import Braces from "~icons/lucide/braces";
import CircleHelp from "~icons/lucide/circle-help";
import FileX from "~icons/lucide/file-x";
import Lock from "~icons/lucide/lock";
import OctagonAlert from "~icons/lucide/octagon-alert";
import ShieldCheck from "~icons/lucide/shield-check";
import ShieldX from "~icons/lucide/shield-x";
import Table2 from "~icons/lucide/table-2";
import TriangleAlert from "~icons/lucide/triangle-alert";
import type { Diagnostic, ElevationFact, RouteInputFact, WrapperState } from "@facilis.dev/analyze";
import { t } from "@/i18n";
import { lodScreenPx } from "@/facilis/graph-lod";
import { routeInputPresent } from "@/facilis/graph-contract";
import { worstSeverity } from "@/facilis/graph-diagnostics";

type BadgeTone = "ok" | "warn" | "bad" | "muted" | "info";

const TONE_CLASS: Record<BadgeTone, string> = {
  ok: "border-success/50 bg-success/10 text-success",
  warn: "border-warning/50 bg-warning/10 text-warning",
  bad: "border-destructive/50 bg-destructive/10 text-destructive",
  muted: "border-border text-muted-foreground",
  info: "border-info/40 bg-info/10 text-info",
};

// The unknown hatch: role-token currentColor stripes, never a raw palette value (D-044).
const HATCH_STYLE: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(45deg, transparent 0px, transparent 3px, " +
    "color-mix(in srgb, currentColor 35%, transparent) 3px, " +
    "color-mix(in srgb, currentColor 35%, transparent) 4px)",
};

// Counter-scaled box (issue #60): constant screen size at every zoom, no per-frame re-render.
const BADGE_STYLE: CSSProperties = {
  fontSize: lodScreenPx(9),
  paddingLeft: lodScreenPx(4),
  paddingRight: lodScreenPx(4),
  columnGap: lodScreenPx(2),
};

const GLYPH_STYLE: CSSProperties = { width: lodScreenPx(10), height: lodScreenPx(10) };

interface FactBadgeProps {
  readonly testId: string;
  readonly tone: BadgeTone;
  readonly glyph: ReactNode;
  readonly label: string;
  /** Rendered in compact mode too: the count survives where the words drop. */
  readonly count?: number;
  readonly title?: string;
  readonly compact: boolean;
  readonly unknown?: boolean;
}

export function FactBadge({
  testId,
  tone,
  glyph,
  label,
  count,
  title,
  compact,
  unknown,
}: FactBadgeProps) {
  // Unknown facts are rings (rounded-full + hatch); known facts are pills. Shape, pattern, glyph
  // and label all differ, so the three states never read as one another.
  const shape =
    unknown === true
      ? "rounded-full border-warning/60 text-warning"
      : "rounded " + TONE_CLASS[tone];
  return (
    <span
      data-testid={testId}
      data-unknown={unknown === true ? "true" : undefined}
      title={title ?? label}
      className={"inline-flex shrink-0 items-center border bg-card/95 " + shape}
      style={unknown === true ? { ...BADGE_STYLE, ...HATCH_STYLE } : BADGE_STYLE}
    >
      <span aria-hidden className="flex shrink-0 [&>svg]:size-full" style={GLYPH_STYLE}>
        {glyph}
      </span>
      {compact ? (
        count !== undefined && <span className="tabular-nums">{count}</span>
      ) : (
        <span>{label}</span>
      )}
    </span>
  );
}

export function WrapperBadge({ wrapper, compact }: { wrapper: WrapperState; compact: boolean }) {
  if (wrapper === "unknown") {
    return (
      <FactBadge
        testId="contract-wrapper"
        tone="warn"
        unknown
        glyph={<CircleHelp className="size-2.5" />}
        label={t("projectGraph.wrapper.unknown")}
        compact={compact}
      />
    );
  }
  const valid = wrapper === "valid";
  return (
    <FactBadge
      testId="contract-wrapper"
      tone={valid ? "ok" : "bad"}
      glyph={valid ? <ShieldCheck className="size-2.5" /> : <ShieldX className="size-2.5" />}
      label={t(valid ? "projectGraph.wrapper.valid" : "projectGraph.wrapper.invalid")}
      compact={compact}
    />
  );
}

/** Input presence: present / absent / unknown are three distinct badges, never collapsed. */
export function InputBadge({
  input,
  unknown,
  compact,
}: {
  input: RouteInputFact;
  unknown: boolean;
  compact: boolean;
}) {
  if (unknown) {
    return (
      <FactBadge
        testId="contract-input"
        tone="warn"
        unknown
        glyph={<Braces className="size-2.5" />}
        label={t("projectGraph.contract.inputUnknown")}
        compact={compact}
      />
    );
  }
  const present = routeInputPresent(input);
  return (
    <FactBadge
      testId="contract-input"
      tone={present ? "info" : "warn"}
      glyph={present ? <Braces className="size-2.5" /> : <FileX className="size-2.5" />}
      label={t(present ? "projectGraph.contract.input" : "projectGraph.contract.noInput")}
      compact={compact}
    />
  );
}

export function TablesBadge({
  count,
  unknown,
  compact,
}: {
  count: number;
  unknown: boolean;
  compact: boolean;
}) {
  return (
    <FactBadge
      testId="contract-tables"
      tone="muted"
      unknown={unknown}
      glyph={<Table2 className="size-2.5" />}
      label={t(unknown ? "projectGraph.contract.tablesUnknown" : "projectGraph.contract.tables", {
        count,
      })}
      count={unknown ? undefined : count}
      compact={compact}
    />
  );
}

/** The elevation lock: count on the badge, the elevation names on hover. */
export function ElevationsBadge({
  elevations,
  compact,
}: {
  elevations: readonly ElevationFact[];
  compact: boolean;
}) {
  const names = elevations.map((elevation) => elevation.operation ?? elevation.kind).join(", ");
  return (
    <FactBadge
      testId="contract-elevations"
      tone="warn"
      glyph={<Lock className="size-2.5" />}
      label={t("projectGraph.contract.elevations", { count: elevations.length })}
      count={elevations.length}
      title={t("projectGraph.contract.elevationsHint", { names })}
      compact={compact}
    />
  );
}

/** Attached analyzer diagnostics: severity glyph + count, the messages in the tooltip. */
export function DiagnosticsBadge({
  diagnostics,
  compact,
}: {
  diagnostics: readonly Diagnostic[];
  compact: boolean;
}) {
  const severity = worstSeverity(diagnostics);
  if (severity === null) return null;
  return (
    <FactBadge
      testId="contract-diagnostics"
      tone={severity === "error" ? "bad" : "warn"}
      glyph={
        severity === "error" ? (
          <OctagonAlert className="size-2.5" />
        ) : (
          <TriangleAlert className="size-2.5" />
        )
      }
      label={t("projectGraph.contract.nodeDiagnostics", { count: diagnostics.length })}
      count={diagnostics.length}
      title={diagnostics.map((entry) => entry.message).join("\n")}
      compact={compact}
    />
  );
}
