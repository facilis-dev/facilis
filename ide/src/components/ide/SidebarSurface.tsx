// What the sidebar shows, split out of the shell so the desktop split-pane and the
// narrow drawer render the same surface instead of drifting apart.
import { Explorer } from "./Explorer";
import { SearchPane } from "./SearchPane";
import { DebugPanel } from "./DebugPanel";
import { SourceControlPanel } from "./SourceControlPanel";
import { ChatPanel } from "./ChatPanel";
import { DataExplorerPanel } from "./DataExplorerPanel";
import { ReleasePreviewPanel } from "./ReleasePreviewPanel";
import { LogsPanel } from "./LogsPanel";
import { useIde } from "./useIde";
import { DEBUG_PANEL_ENABLED } from "@/facilis/debug-panel-flag";

export function SidebarSurface({ chatEnabled }: { chatEnabled: boolean }) {
  const { snap } = useIde();
  if (snap.activeView === "search") return <SearchPane />;
  if (DEBUG_PANEL_ENABLED && snap.activeView === "debug") return <DebugPanel />;
  if (snap.activeView === "scm") return <SourceControlPanel />;
  if (snap.activeView === "data") return <DataExplorerPanel />;
  if (snap.activeView === "release") return <ReleasePreviewPanel />;
  if (snap.activeView === "logs") return <LogsPanel />;
  if (snap.activeView === "chat" && chatEnabled) return <ChatPanel />;
  return <Explorer />;
}
