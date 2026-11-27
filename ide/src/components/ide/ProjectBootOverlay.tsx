// A reload of a tab that already has a project must not visit Home first.
//
// The controller's initial view is "workspace" whenever the URL carries ?project=
// (boot-target.ts); this overlay covers the gap between that first paint and the
// project actually being open. Without it the reload would show an empty IDE while the
// kernel boots — the same jump as the old Home flash, in the other direction.
import { useEffect, useLayoutEffect, useRef } from "react";
import { t } from "@/i18n";
import { projectName } from "@/vv/project-name";
import { BootStatus } from "./BootStatus";
import { restoreWorkspaceFocus } from "./home-focus";
import { useBlockingLayer } from "./use-blocking-layer";
import { useIde } from "./useIde";

export function ProjectBootOverlay() {
  const { snap } = useIde();
  const rootRef = useRef<HTMLDivElement>(null);
  // The cover is a sibling of the workspace frame, and it holds focus for as long as it is
  // up, so the frame stays inert even though the graph and the shell are still mounted (#217).
  useBlockingLayer("project-boot", snap.bootProject !== null);
  useLayoutEffect(() => {
    rootRef.current?.focus();
  }, []);
  // A reload has no opener: Home's title-bar brand is the defined return target (#212).
  useEffect(() => () => restoreWorkspaceFocus(null), []);
  if (!snap.bootProject) return null;
  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      data-blocking-overlay=""
      className="absolute inset-0 z-50 flex items-center justify-center bg-background/85 p-6 backdrop-blur-sm outline-none"
    >
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
