// The shell below 1024px: one full-width surface, the sidebar as a drawer, and the
// preview as a destination instead of a third pane (issue #195).
//
// The two surfaces are both mounted, and the inactive one is hidden with CSS: the
// editor and the preview frame keep their state, so switching back and forth does not
// reload the app — on a phone that reload is the slowest thing in the loop.
import { useEffect, useLayoutEffect, useRef } from "react";
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
import { drawerEscapeCloses } from "./narrow-drawer-escape";
import { useIde } from "./useIde";
import { isTypingTarget } from "./useProjectGraphEscape";

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
  const drawerRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const drawerWasOpen = useRef(false);
  useEffect(() => {
    if (sidebarOpen && snap.activeTab !== lastTab.current) c.toggleSidebar(false);
    lastTab.current = snap.activeTab;
  }, [c, sidebarOpen, snap.activeTab]);
  // Escape is the drawer's, but only when the user is not typing into it and no handler on
  // top (a dialog or the graph ladder) already consumed the key (#217).
  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const typing = isTypingTarget(e.target);
      if (drawerEscapeCloses({ key: e.key, defaultPrevented: e.defaultPrevented, typing })) {
        c.toggleSidebar(false);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [c, sidebarOpen]);
  // Focus belongs to the drawer while it is up and goes back to the nav button that opens
  // it. A nav click already moved focus, so only recover a focus the close dropped.
  useLayoutEffect(() => {
    if (sidebarOpen) {
      drawerWasOpen.current = true;
      drawerRef.current?.focus();
      return;
    }
    if (!drawerWasOpen.current) return;
    drawerWasOpen.current = false;
    if (document.activeElement === document.body) {
      navRef.current?.querySelector("button")?.focus();
    }
  }, [sidebarOpen]);

  return (
    <>
      <div className="relative flex min-h-0 flex-1">
        {/* The scrim covers the two content columns but not the bottom nav, so only they go
            inert while the drawer is open; the nav button that closes it stays usable. */}
        <div className="contents" inert={sidebarOpen}>
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
        </div>
        {sidebarOpen && (
          <>
            <div
              className="absolute inset-0 z-20 bg-background/70 backdrop-blur-sm"
              onClick={() => c.toggleSidebar(false)}
            />
            <div
              ref={drawerRef}
              role="dialog"
              aria-label={t("shell.mobile.files")}
              data-blocking-overlay=""
              tabIndex={-1}
              className="absolute inset-y-0 left-0 z-30 flex w-[85%] max-w-sm border-r bg-sidebar shadow-xl outline-none"
            >
              <ActivityBar />
              <div data-tour="sidebar" className="min-h-0 min-w-0 flex-1">
                <SidebarSurface chatEnabled={chatEnabled} />
              </div>
            </div>
          </>
        )}
      </div>
      <nav
        ref={navRef}
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
