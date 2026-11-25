// The graph surface chrome (issues #184/#187/#191): overview/domain breadcrumb and interaction
// hint. Both are HUD controls, so the drawer's reserved column clamps them: a long breadcrumb or
// hint can never slide under the floating inspector (#144). When the inspector is a bottom sheet
// the hint is hidden instead of hiding behind it.

import { t } from "@/i18n";

export function ProjectGraphSurfaceChrome({
  domain,
  reservedRight,
  sheet,
  onBack,
}: {
  /** null in overview mode; the open domain's name in detail mode. */
  domain: string | null;
  /** The drawer's reserved screen width, so the HUD stays outside it. */
  reservedRight: number;
  /** The bottom sheet covers the bottom edge: the hint would sit behind it. */
  sheet: boolean;
  onBack: () => void;
}) {
  const maxWidth = reservedRight > 0 ? `calc(100% - ${reservedRight + 16}px)` : undefined;
  return (
    <>
      <nav
        aria-label={t("projectGraph.surface.breadcrumb")}
        style={{ maxWidth }}
        className="absolute left-2 top-2 flex items-center gap-1 overflow-hidden text-xs"
      >
        {domain !== null ? (
          <>
            <button
              type="button"
              data-testid="project-graph-overview"
              className="shrink-0 rounded border border-border bg-panel px-2 py-1 text-muted-foreground hover:text-foreground"
              onClick={onBack}
            >
              {t("projectGraph.surface.overview")}
            </button>
            <span className="shrink-0 text-muted-foreground">/</span>
            <span className="truncate rounded border border-border bg-panel px-2 py-1 font-medium text-foreground">
              {domain}
            </span>
          </>
        ) : (
          <span
            data-testid="project-graph-overview"
            className="shrink-0 rounded border border-border bg-panel px-2 py-1 text-muted-foreground"
          >
            {t("projectGraph.surface.overview")}
          </span>
        )}
      </nav>
      {!sheet && (
        <p
          style={{ maxWidth }}
          className="pointer-events-none absolute bottom-2 left-2 truncate rounded bg-panel/80 px-2 py-1 text-[10px] text-muted-foreground"
        >
          {t(domain !== null ? "projectGraph.surface.detailHint" : "projectGraph.surface.hint")}
        </p>
      )}
    </>
  );
}
