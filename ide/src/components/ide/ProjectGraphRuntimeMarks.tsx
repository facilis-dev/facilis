// The runtime lens's card layer (issue #72): a corner heat dot (5 intensity steps on the info
// role token) plus a destructive error dot when the window saw 5xx, and — above the local zoom
// threshold — the request count. The marks ADD to the card's contract badges, never replace
// them, and sit absolutely positioned against the React Flow node wrapper, so the card's layout
// and every node position are untouched (epic rule 2). No traffic draws nothing: empty is never
// a green/healthy mark (epic rule 5). A secondary lens draws at 30% (epic rule 3).
//
// The lens settings travel through context, NOT node data: traffic updates every second, and
// pushing them through buildProjectGraphFlowNodes would rebuild every card's data object on
// each tick. With the lens off the context value is a stable null, so route cards render exactly
// as before — no subscription exists and no prop identity changes (acceptance criteria 1/6).

import { createContext, useMemo, useSyncExternalStore } from "react";
import { t, type MessageKey } from "@/i18n";
import {
  getRuntimeLensStore,
  normalizeRouteTemplate,
  type RuntimeWindow,
} from "@/facilis/graph-runtime";
import type { RouteGraphData } from "@/facilis/graph-types";

export interface RuntimeLensContextValue {
  readonly window: RuntimeWindow;
  /** False below RUNTIME_COMPACT_ZOOM: the corner dot only (chip LOD, epic rule 4). */
  readonly detailed: boolean;
  /** True when the runtime lens is the secondary one: the marks recede to 30%. */
  readonly secondary: boolean;
}

/** null = lens inactive; the stable null keeps inactive cards free of re-renders. */
export const RuntimeLensContext = createContext<RuntimeLensContextValue | null>(null);

/** 5 intensity steps on one semantic role token (D-044): opacity carries the heat level. */
const HEAT_CLASS = ["bg-info/25", "bg-info/45", "bg-info/65", "bg-info/85", "bg-info"] as const;

export function heatDotClass(heat: number): string {
  const level = Math.min(Math.max(Math.round(heat), 1), HEAT_CLASS.length);
  // Level is clamped to 1..5, so the index is always present.
  return HEAT_CLASS[level - 1] as string;
}

export function RouteRuntimeMarks({
  route,
  lens,
}: {
  route: RouteGraphData;
  lens: RuntimeLensContextValue;
}) {
  const store = getRuntimeLensStore();
  const template = normalizeRouteTemplate(route.path);
  // Per-route subscription granularity: a batch touching route A notifies A's listeners only,
  // and the store keeps B's snapshot identity stable, so B's card does not re-render.
  const source = useMemo(
    () => store.routeSource(template, lens.window),
    [store, template, lens.window],
  );
  const view = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getServerSnapshot);
  const stats = view.stats;
  if (stats === null) return null;
  const windowLabel = t(("projectGraph.runtime.window." + lens.window) as MessageKey);
  const heatLabel = t("projectGraph.runtime.heat", { count: stats.count, window: windowLabel });
  return (
    <div
      data-testid="runtime-marks-route"
      className={
        "absolute -top-1.5 -right-1.5 flex items-center gap-0.5" +
        (lens.secondary ? " opacity-30" : "")
      }
    >
      {lens.detailed && (
        <span
          data-testid="runtime-count"
          title={heatLabel}
          className="rounded border border-border bg-card/95 px-1 text-[9px] tabular-nums text-muted-foreground"
        >
          {stats.count}
        </span>
      )}
      {stats.errors > 0 && (
        <span
          data-testid="runtime-error-dot"
          role="img"
          aria-label={t("projectGraph.runtime.errorDot", {
            count: stats.errors,
            window: windowLabel,
          })}
          title={t("projectGraph.runtime.errorDot", { count: stats.errors, window: windowLabel })}
          className="size-2.5 shrink-0 rounded-full border border-card bg-destructive"
        />
      )}
      <span
        data-testid="runtime-heat-dot"
        role="img"
        aria-label={heatLabel}
        title={heatLabel}
        className={"size-2.5 shrink-0 rounded-full border border-card " + heatDotClass(stats.heat)}
      />
    </div>
  );
}
