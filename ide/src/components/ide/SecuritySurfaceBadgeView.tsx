// The declared-surface badge's presentational half (D-226, #235). Split from the connected
// component so it renders with plain props: the counts come from the dev endpoint, green means
// nothing undeclared/unknown remains, and an unavailable endpoint renders no chrome at all.

import Download from "~icons/lucide/download";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { SecuritySurfaceSummary } from "@/facilis/security-surface-client";

/** Only a surface with no undeclared and no unknown entry is green (D-226). */
export function isSurfaceClean(summary: SecuritySurfaceSummary): boolean {
  return summary.undeclared === 0 && summary.unknown === 0;
}

export function SecuritySurfaceBadgeView({
  summary,
  busy = false,
  onDownload,
}: {
  /** null while the endpoint has not answered, or when it is unavailable. */
  summary: SecuritySurfaceSummary | null;
  busy?: boolean;
  onDownload: () => void;
}) {
  if (summary === null) return null;
  const tone = isSurfaceClean(summary)
    ? "border-success/40 bg-success/10 text-success"
    : "border-warning/50 bg-warning/10 text-warning";
  return (
    <span data-testid="security-surface-badge" className="flex items-center gap-0.5">
      <span
        title={t("projectGraph.surface.security.tooltip", {
          standard: summary.standard,
          declared: summary.declared,
          undeclared: summary.undeclared,
          unknown: summary.unknown,
        })}
        className={"rounded border px-1.5 py-0.5 text-[10px] " + tone}
      >
        {t("projectGraph.surface.security.badge", {
          declared: summary.declared,
          undeclared: summary.undeclared,
          unknown: summary.unknown,
        })}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t("projectGraph.surface.security.download")}
        title={t("projectGraph.surface.security.download")}
        disabled={busy}
        onClick={onDownload}
      >
        <Download />
      </Button>
    </span>
  );
}
