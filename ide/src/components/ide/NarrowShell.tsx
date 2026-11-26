// The shell below 1024px: one full-width surface, the sidebar as a drawer, and the
// preview as a destination instead of a third pane (issue #195).
//
// The two surfaces are both mounted, and the inactive one is hidden with CSS: the
// editor and the preview frame keep their state, so switching back and forth does not
// reload the app — on a phone that reload is the slowest thing in the loop.
import { useEffect, useRef } from "react";
import Code from "~icons/lucide/code";
import Files from "~icons/lucide/files";
import Monitor from "~icons/lucide/monitor";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { ActivityBar } from "./ActivityBar";
import { EditorGroup } from "./EditorGroup";
import { PreviewPanel } from "./PreviewPanel";
import { SidebarSurface } from "./SidebarSurface";
import { TerminalPanel } from "./TerminalPanel";
import { useIde } from "./useIde";

function NavButton({
  label,
  active,
  onClick,
  Icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] transition-colors",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

export function NarrowShell({ chatEnabled }: { chatEnabled: boolean }) {
  const { c, snap } = useIde();
  const sidebarOpen = !snap.sidebarCollapsed;
  const previewOpen = !snap.previewCollapsed;
  // Picking a file in the drawer is the one action that should dismiss it: the user
  // came for that file, and the editor is now underneath the sheet.
  const lastTab = useRef(snap.activeTab);
  useEffect(() => {
    if (sidebarOpen && snap.activeTab !== lastTab.current) c.toggleSidebar(false);
    lastTab.current = snap.activeTab;
  }, [c, sidebarOpen, snap.activeTab]);
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") c.toggleSidebar(false);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [c, sidebarOpen]);

  return (
    <>
      <div className="relative flex min-h-0 flex-1">
        <div className={cn("flex min-w-0 flex-1 flex-col", previewOpen && "hidden")}>
          <div data-tour="editor" className="min-h-0 flex-1">
            <EditorGroup />
          </div>
          {!snap.panelCollapsed && (
            <div data-tour="console" className="h-2/5 min-h-32 shrink-0 border-t">
              <TerminalPanel />
            </div>
          )}
        </div>
        <div className={cn("min-w-0 flex-1", !previewOpen && "hidden")}>
          <div data-tour="preview" className="h-full min-h-0">
            <PreviewPanel />
          </div>
        </div>
        {sidebarOpen && (
          <>
            <div
              className="absolute inset-0 z-20 bg-background/70 backdrop-blur-sm"
              onClick={() => c.toggleSidebar(false)}
            />
            <div className="absolute inset-y-0 left-0 z-30 flex w-[85%] max-w-sm border-r bg-sidebar shadow-xl">
              <ActivityBar />
              <div data-tour="sidebar" className="min-h-0 min-w-0 flex-1">
                <SidebarSurface chatEnabled={chatEnabled} />
              </div>
            </div>
          </>
        )}
      </div>
      <nav
        data-slot="mobile-shell-nav"
        className="flex h-12 shrink-0 items-stretch border-t bg-sidebar"
      >
        <NavButton
          label={t("shell.mobile.files")}
          active={sidebarOpen}
          onClick={() => c.toggleSidebar()}
          Icon={Files}
        />
        <NavButton
          label={t("shell.mobile.code")}
          active={!previewOpen && !sidebarOpen}
          onClick={() => c.togglePreview(false)}
          Icon={Code}
        />
        <NavButton
          label={t("shell.mobile.preview")}
          active={previewOpen}
          onClick={() => c.togglePreview(true)}
          Icon={Monitor}
        />
      </nav>
    </>
  );
}
