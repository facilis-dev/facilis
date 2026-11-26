// The shell at 1024px and above: the activity rail plus the three resizable panes,
// unchanged from the desktop-first layout issue #195 must not regress.
import { useEffect, useRef } from "react";
import { usePanelRef } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ActivityBar } from "./ActivityBar";
import { EditorGroup } from "./EditorGroup";
import { TerminalPanel } from "./TerminalPanel";
import { PreviewPanel } from "./PreviewPanel";
import { SidebarSurface } from "./SidebarSurface";
import { useIde } from "./useIde";

export function DesktopShell({ chatEnabled }: { chatEnabled: boolean }) {
  const { snap } = useIde();
  // Chat is text-heavy, so opening it widens the sidebar and leaving it restores
  // the Explorer width. Only the automatic widen is undone: a width the user
  // dragged themselves (anything above the widen target) is left alone.
  const sidebarPanel = usePanelRef();
  const widenedForPanel = useRef(false);
  const chatOpen = chatEnabled && snap.activeView === "chat" && !snap.sidebarCollapsed;
  // The release diff wants room too: it is unreadable in the Explorer's 16% width, so it
  // gets the same automatic widening as the chat.
  const roomyView = chatOpen || snap.activeView === "release";
  useEffect(() => {
    // The panel is unmounted while the sidebar is collapsed; restoring it (e.g. switching
    // from the chat to a sidebar view) can run this effect before the library has
    // registered the new layout, and getSize() throws "Layout not found".
    // Defer to the next frame and retry a few times instead of crashing the shell.
    let attempts = 0;
    const applyWidth = () => {
      const panel = sidebarPanel.current;
      if (!panel) return;
      let percent: number;
      try {
        percent = panel.getSize().asPercentage;
      } catch {
        if (attempts < 5) {
          attempts += 1;
          requestAnimationFrame(applyWidth);
        }
        return;
      }
      if (roomyView) {
        if (percent < 22) {
          widenedForPanel.current = true;
          panel.resize("28%");
        }
      } else if (widenedForPanel.current && percent > 16) {
        widenedForPanel.current = false;
        panel.resize("16%");
      }
    };
    const frame = requestAnimationFrame(applyWidth);
    return () => cancelAnimationFrame(frame);
  }, [roomyView, sidebarPanel, snap.sidebarCollapsed]);

  return (
    <div className="flex min-h-0 flex-1">
      <ActivityBar />
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        {!snap.sidebarCollapsed && (
          <>
            <ResizablePanel
              panelRef={sidebarPanel}
              id="explorer"
              defaultSize="16%"
              minSize="10%"
              maxSize="45%"
            >
              <div data-tour="sidebar" className="h-full min-h-0">
                <SidebarSurface chatEnabled={chatEnabled} />
              </div>
            </ResizablePanel>
            <ResizableHandle />
          </>
        )}
        <ResizablePanel id="center" defaultSize="52%" minSize="25%">
          <ResizablePanelGroup orientation="vertical">
            <ResizablePanel id="editor" defaultSize="65%" minSize="20%">
              <div data-tour="editor" className="h-full min-h-0">
                <EditorGroup />
              </div>
            </ResizablePanel>
            {!snap.panelCollapsed && (
              <>
                <ResizableHandle />
                <ResizablePanel id="terminal" defaultSize="35%" minSize="10%">
                  <div data-tour="console" className="h-full min-h-0">
                    <TerminalPanel />
                  </div>
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </ResizablePanel>
        {!snap.previewCollapsed && (
          <>
            <ResizableHandle />
            <ResizablePanel id="preview" defaultSize="32%">
              <div data-tour="preview" className="h-full min-h-0">
                <PreviewPanel />
              </div>
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
}
