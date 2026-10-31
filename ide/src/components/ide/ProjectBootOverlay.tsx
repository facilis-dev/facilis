// A reload of a tab that already has a project must not visit Home first.
//
// The controller's initial view is "workspace" whenever the URL carries ?project=
// (boot-target.ts); this overlay covers the gap between that first paint and the
// project actually being open. Without it the reload would show an empty IDE while the
// kernel boots — the same jump as the old Home flash, in the other direction.
import { t } from "@/i18n";
import { projectName } from "@/vv/project-name";
import { BootStatus } from "./BootStatus";
import { useIde } from "./useIde";

export function ProjectBootOverlay() {
  const { snap } = useIde();
  if (!snap.bootProject) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/85 p-6 backdrop-blur-sm">
      <div className="w-full max-w-md">
        <div className="mb-3">
          <div className="text-base font-medium">
            {t("boot.openingTitle", { name: projectName(snap.bootProject) })}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">{t("boot.openingHint")}</div>
        </div>
        <BootStatus />
      </div>
    </div>
  );
}
