// The graph surface chrome (issue #184): the overview/domain breadcrumb and the interaction
// hint. Kept apart from ProjectGraphSurface so the canvas component stays under the line limit.

import { t } from "@/i18n";

export function ProjectGraphSurfaceChrome({
  domain,
  onBack,
}: {
  /** null in overview mode; the open domain's name in detail mode. */
  domain: string | null;
  onBack: () => void;
}) {
  return (
    <>
      <nav
        aria-label={t("projectGraph.surface.breadcrumb")}
        className="absolute left-2 top-2 flex items-center gap-1 text-xs"
      >
        {domain !== null ? (
          <>
            <button
              type="button"
              className="rounded border border-border bg-panel px-2 py-1 text-muted-foreground hover:text-foreground"
              onClick={onBack}
            >
              {t("projectGraph.surface.overview")}
            </button>
            <span className="text-muted-foreground">/</span>
            <span className="rounded border border-border bg-panel px-2 py-1 font-medium text-foreground">
              {domain}
            </span>
          </>
        ) : (
          <span className="rounded border border-border bg-panel px-2 py-1 text-muted-foreground">
            {t("projectGraph.surface.overview")}
          </span>
        )}
      </nav>
      <p className="pointer-events-none absolute bottom-2 left-2 rounded bg-panel/80 px-2 py-1 text-[10px] text-muted-foreground">
        {t("projectGraph.surface.hint")}
      </p>
    </>
  );
}
