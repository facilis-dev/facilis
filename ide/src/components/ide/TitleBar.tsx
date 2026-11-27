import { toast } from "sonner";
import CircleHelp from "~icons/lucide/circle-help";
import ExternalLink from "~icons/lucide/external-link";
import Home from "~icons/lucide/house";
import Monitor from "~icons/lucide/monitor";
import PanelLeft from "~icons/lucide/panel-left";
import PanelLeftOff from "~icons/lucide/panel-left-dashed";
import PanelRight from "~icons/lucide/panel-right";
import PanelRightOff from "~icons/lucide/panel-right-dashed";
import Play from "~icons/lucide/play";
import Square from "~icons/lucide/square";
import { tourStore } from "@/components/tour/tour-store-instance";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { openStudioInNewTab } from "@/vv/project-tabs";
import { useIde } from "./useIde";
import { formatShortcut } from "./shortcuts";

/** One layout toggle, in the cluster at the far right. lucide ships a solid-divider
 * and a dashed-divider glyph per edge (the dashed one is aliased -inactive in the
 * pack), so the icon itself says whether that panel is showing — VS Code reads its
 * layout the same way, by drawing the sub-panel region differently. The dimmed
 * foreground when hidden is the second, coarser channel: at 16px a dashed rule is
 * easy to miss on its own.
 *
 * The bottom panel is not here any more (D-124): it is closed by default and its
 * surfaces open from the status bar, next to the Run control. */
function LayoutToggle({
  label,
  keys,
  shown,
  onClick,
  On,
  Off,
}: {
  label: string;
  keys: string;
  shown: boolean;
  onClick: () => void;
  On: React.ComponentType<{ className?: string }>;
  Off: React.ComponentType<{ className?: string }>;
}) {
  const Icon = shown ? On : Off;
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onClick}
        aria-pressed={shown}
        aria-label={label}
        className={cn(
          "flex size-7 items-center justify-center rounded transition-colors hover:bg-accent",
          shown ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        <span className="text-background/60">{keys}</span>
      </TooltipContent>
    </Tooltip>
  );
}

export function TitleBar() {
  const { c, snap } = useIde();
  // The title-bar twin of the status bar's Run chip: same control, same state, so
  // the primary action is reachable from either corner (D-124).
  const running = snap.runTerminalId != null;
  // The always-available external preview (issue #44): the control must outlive the
  // Preview panel, so its port comes from the run state, not from the panel's tab.
  const activeRoot =
    snap.workspaceFolders.find((f) => f.id === snap.activeFolderId)?.rootPath ?? null;
  const externalPort = c.preview.externalPreviewPort(activeRoot, snap.ports);
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b bg-sidebar pr-2 pl-3 text-sm lg:gap-3">
      {/* The narrow shell keeps only the title, the Run control and the status bar:
          everything here is a desktop affordance with a place in the drawer or the
          bottom navigation (issue #195). */}
      <button
        className="hidden shrink-0 items-center lg:flex"
        onClick={() => c.goHome()}
        title={t("title.home")}
        aria-label={t("app.name")}
      >
        <span aria-hidden className="brand-lockup h-6 w-[120px]" />
      </button>

      <div className="flex-1 truncate text-center text-xs text-muted-foreground">
        {snap.projectTitle ? snap.projectTitle : t("title.tagline")}
      </div>

      {/* App actions, then the layout cluster hugging the corner — VS Code keeps its
          layout controls at the far edge, apart from whatever sits beside them. */}
      <div className="flex shrink-0 items-center gap-1">
        {running ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => c.stopRun()}
            aria-label={t("run.stopHint")}
          >
            <Square className="size-3.5" />{" "}
            <span className="hidden sm:inline">{t("run.stop")}</span>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => c.runActiveFolder()}
            aria-label={t("run.startHint")}
          >
            <Play className="size-4" /> <span className="hidden sm:inline">{t("run.start")}</span>
          </Button>
        )}
        <Tooltip>
          <TooltipTrigger
            onClick={openStudioInNewTab}
            aria-label={t("title.openNewTab")}
            className="hidden size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:flex"
          >
            <ExternalLink className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("title.newTab")}</TooltipContent>
        </Tooltip>
        <Button
          variant="ghost"
          size="sm"
          className="hidden lg:inline-flex"
          onClick={() => c.goHome()}
        >
          <Home className="size-4" /> {t("title.home")}
        </Button>
        <div aria-hidden className="mx-1 h-5 w-px bg-border" />
        <Tooltip>
          <TooltipTrigger
            onClick={() => tourStore.start()}
            aria-label={t("tour.helpAria")}
            className="hidden size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:flex"
          >
            <CircleHelp className="size-4" />
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("tour.helpAria")}</TooltipContent>
        </Tooltip>
        {/* Layout toggles and the external preview are split-pane affordances: the
            narrow shell reaches the same surfaces from its bottom navigation. */}
        <div className="hidden items-center gap-1 lg:flex">
          <LayoutToggle
            label={t("title.toggleSidebar")}
            keys={formatShortcut("sidebar-toggle")}
            shown={!snap.sidebarCollapsed}
            onClick={() => c.toggleSidebar()}
            On={PanelLeft}
            Off={PanelLeftOff}
          />
          <LayoutToggle
            label={t("title.togglePreview")}
            keys={formatShortcut("preview-toggle")}
            shown={!snap.previewCollapsed}
            onClick={() => c.togglePreview()}
            On={PanelRight}
            Off={PanelRightOff}
          />
          {/* The external preview is the point of hiding the panel, so the control must
            stay here when the panel is gone — disabled, never hidden, when nothing runs. */}
          {snap.workspaceFolders.length > 0 && (
            <Tooltip>
              <TooltipTrigger
                onClick={() => {
                  if (externalPort === null) return;
                  if (!c.preview.openExternalPreview(externalPort))
                    toast.error(t("preview.openExternalBlocked"));
                }}
                aria-disabled={externalPort === null}
                aria-label={
                  externalPort === null
                    ? t("preview.openExternalDisabled")
                    : t("preview.openExternalHint")
                }
                className={cn(
                  "flex size-7 items-center justify-center rounded transition-colors",
                  externalPort === null
                    ? "cursor-not-allowed text-muted-foreground/40"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Monitor className="size-4" />
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {externalPort === null
                  ? t("preview.openExternalDisabled")
                  : t("preview.openExternalHint")}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  );
}
