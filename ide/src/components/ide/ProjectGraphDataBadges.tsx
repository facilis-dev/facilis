// The data lens's schema badges (issue #70): scope and policy count for tables, access mode
// and permission for views. One badge per fact, each carrying a glyph AND a label or tooltip —
// never colour alone (epic rule 6). An unknown fact renders as a hatched ring, visually distinct
// from both "ok" and "absent" (epic rule 5): the hatch derives from currentColor, a role token,
// so both themes keep the pattern (D-044). Every size counter-scales through lodScreenPx like the
// contract lens's badges (#69): the text stays at 9 SCREEN px wherever the badges draw, never
// below the 7px floor (epic rule 4). At compact zoom the badges drop their words and keep
// glyph+count, the full label staying in the title. Data-namespaced so the data and contract
// lenses compose and merge cleanly.

import type { CSSProperties, ReactNode } from "react";
import CircleHelp from "~icons/lucide/circle-help";
import CircleSlash from "~icons/lucide/circle-slash";
import KeyRound from "~icons/lucide/key-round";
import Shield from "~icons/lucide/shield";
import User from "~icons/lucide/user";
import UserCog from "~icons/lucide/user-cog";
import Users from "~icons/lucide/users";
import { t, type MessageKey } from "@/i18n";
import { lodScreenPx } from "@/facilis/graph-lod";
import { tableScopeState, type TableScopeState } from "@/facilis/graph-data-lens";
import type { TableGraphData, ViewGraphData } from "@/facilis/graph-types";

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

interface DataBadgeProps {
  readonly testId: string;
  readonly tone: BadgeTone;
  readonly glyph: ReactNode;
  readonly label: string;
  /** Rendered in compact mode too: the count survives where the words drop. */
  readonly count?: number;
  readonly title?: string;
  readonly compact: boolean;
  readonly unknown?: boolean;
  /** The fact's classified state, exposed for the browser gate's DOM scan. */
  readonly state?: string;
}

export function DataFactBadge({
  testId,
  tone,
  glyph,
  label,
  count,
  title,
  compact,
  unknown,
  state,
}: DataBadgeProps) {
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
      data-state={state}
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

const SCOPE_LABEL_KEYS: Record<TableScopeState, MessageKey> = {
  tenant: "projectGraph.data.scope.tenant",
  owner: "projectGraph.data.scope.owner",
  none: "projectGraph.data.scope.none",
  unknown: "projectGraph.data.scope.unknown",
};

const SCOPE_GLYPHS: Record<TableScopeState, ReactNode> = {
  tenant: <Users className="size-2.5" />,
  owner: <User className="size-2.5" />,
  none: <CircleSlash className="size-2.5" />,
  unknown: <CircleHelp className="size-2.5" />,
};

/** The tenancy scope: tenant/owner are scoped classes, "none" is the exception the ribbon counts. */
export function ScopeBadge({ table, compact }: { table: TableGraphData; compact: boolean }) {
  const state = tableScopeState(table);
  const label = t(SCOPE_LABEL_KEYS[state]);
  // A readable scope names its column in the tooltip, like the inspector's scope line.
  const title =
    table.scope === null || table.unknown
      ? label
      : t("projectGraph.scope", {
          column: table.scope.column,
          kind: t(("projectGraph.scopeKind." + table.scope.kind) as MessageKey),
        });
  return (
    <DataFactBadge
      testId="data-scope"
      state={state}
      tone={state === "none" ? "warn" : state === "unknown" ? "warn" : "info"}
      unknown={state === "unknown"}
      glyph={SCOPE_GLYPHS[state]}
      label={label}
      title={title}
      compact={compact}
    />
  );
}

/** The declared policy set's size (restrictive gates included): the inspector names each one. */
export function PoliciesBadge({
  count,
  unknown,
  compact,
}: {
  count: number;
  unknown: boolean;
  compact: boolean;
}) {
  return (
    <DataFactBadge
      testId="data-policies"
      tone="muted"
      unknown={unknown}
      glyph={<Shield className="size-2.5" />}
      label={t(unknown ? "projectGraph.data.policiesUnknown" : "projectGraph.data.policies", {
        count,
      })}
      count={unknown ? undefined : count}
      compact={compact}
    />
  );
}

/** invoker/definer are readable modes; null is the unreadable one (D-098), never a guess. */
export function ViewAccessBadge({
  access,
  compact,
}: {
  access: ViewGraphData["access"];
  compact: boolean;
}) {
  if (access === null) {
    return (
      <DataFactBadge
        testId="data-access"
        state="unknown"
        tone="warn"
        unknown
        glyph={<CircleHelp className="size-2.5" />}
        label={t("projectGraph.data.accessUnknown")}
        compact={compact}
      />
    );
  }
  return (
    <DataFactBadge
      testId="data-access"
      state={access}
      tone={access === "definer" ? "warn" : "muted"}
      glyph={
        access === "definer" ? <UserCog className="size-2.5" /> : <User className="size-2.5" />
      }
      label={t(("projectGraph.access." + access) as MessageKey)}
      compact={compact}
    />
  );
}

export function ViewPermissionBadge({
  permission,
  unknown,
  compact,
}: {
  permission: string | null;
  unknown: boolean;
  compact: boolean;
}) {
  if (unknown) {
    return (
      <DataFactBadge
        testId="data-permission"
        tone="warn"
        unknown
        glyph={<KeyRound className="size-2.5" />}
        label={t("projectGraph.data.permissionUnknown")}
        compact={compact}
      />
    );
  }
  return (
    <DataFactBadge
      testId="data-permission"
      tone="info"
      glyph={<KeyRound className="size-2.5" />}
      label={permission ?? t("projectGraph.public")}
      title={
        permission === null
          ? t("projectGraph.public")
          : t("projectGraph.permission", { permission })
      }
      compact={compact}
    />
  );
}
