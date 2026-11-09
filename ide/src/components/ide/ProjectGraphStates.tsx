// The project-graph's no-project / loading / error / empty states, split from the panel so
// the panel (which owns the analysis and layout lifecycle) stays under the source limit.
// Every string is a project-graph catalogue key (D-043).

import Network from "~icons/lucide/network";
import RefreshCw from "~icons/lucide/refresh-cw";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

const CENTER =
  "pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center";

export type ProjectGraphState =
  | { readonly kind: "no-project" }
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly error: string }
  | { readonly kind: "empty" };

export function ProjectGraphStateView({
  state,
  onRefresh,
}: {
  state: ProjectGraphState;
  onRefresh: () => void;
}) {
  if (state.kind === "no-project") {
    return <p className={CENTER}>{t("projectGraph.openProjectFirst")}</p>;
  }
  if (state.kind === "loading") {
    return (
      <p className={CENTER + " text-xs text-muted-foreground"}>
        <RefreshCw className="size-4 animate-spin" />
        {t("projectGraph.loading")}
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <div className={CENTER}>
        <p className="text-xs font-medium text-destructive">
          {t("projectGraph.error", { error: state.error })}
        </p>
        <Button variant="secondary" size="sm" onClick={onRefresh}>
          {t("projectGraph.refresh")}
        </Button>
      </div>
    );
  }
  return (
    <div className={CENTER}>
      <Network className="size-5 text-muted-foreground" />
      <p className="text-xs font-medium">{t("projectGraph.empty")}</p>
      <p className="max-w-sm text-[11px] text-muted-foreground">{t("projectGraph.emptyHint")}</p>
    </div>
  );
}
