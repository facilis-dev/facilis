import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { appearanceOf } from "@/ui-themes";
import { TitleBar } from "./TitleBar";
import { StatusBar } from "./StatusBar";
import { CommandPalette } from "./CommandPalette";
import { GraphLensPicker } from "./GraphLensPicker";
import { useGraphLensShortcuts } from "./useGraphLensShortcuts";
import { TourHost } from "@/components/tour/TourHost";
import { HomeView } from "./Home";
import { ShareLoadingOverlay } from "./ShareLoadingOverlay";
import { ProjectBootOverlay } from "./ProjectBootOverlay";
import { GitRemoteDialog } from "./GitRemoteDialog";
import { ImportRemoteDialog } from "./ImportRemoteDialog";
import { ResetEverythingDialog } from "./ResetEverythingDialog";
import { PushRemoteDialog } from "./PushRemoteDialog";
import { ScaffoldTemplateDialog } from "./ScaffoldTemplateDialog";
import { RunOnDeviceDialog } from "./RunOnDeviceDialog";
import { DesktopShell } from "./DesktopShell";
import { NarrowShell } from "./NarrowShell";
import { WorkspaceFrame } from "./workspace-frame";
import { trackWorkspaceFocus } from "./home-focus";
import { useIde } from "./useIde";
import { aiAvailable, deployment } from "@/deploy/current";
import { nextTabId } from "./editor-tabs";
import { matchShortcut, shortcutContext, type ShortcutId } from "./shortcuts";
import { readShortcutFocus } from "./shortcut-focus";
import { ShortcutHelpDialog } from "./ShortcutHelpDialog";
import { shortcutHelpUi } from "@/vv/shortcut-help-ui";
import { useNarrowShell } from "@/vv/narrow-shell";

// Once per page load: the compact defaults are applied on the first narrow render
// only, so dragging the window across the breakpoint keeps the user's own layout.
let compactSettled = false;

export function AppShell() {
  const { c, snap } = useIde();
  const lensShortcuts = useGraphLensShortcuts();
  const helpOpen = useSyncExternalStore(shortcutHelpUi.subscribe, shortcutHelpUi.getSnapshot);
  const { theme, resolvedTheme, systemTheme } = useTheme();
  // A managed build with ai.mode "off" must not mount the chat at all (D-063).
  // The view can still be "chat" from the activity bar, so it falls back to the
  // Explorer instead of leaving an empty sidebar.
  const chatEnabled = aiAvailable(deployment);
  const narrow = useNarrowShell();

  // A phone cannot show the rail and the preview side by side: start on the code
  // surface with the drawer closed, then let the user open what they need.
  useLayoutEffect(() => {
    if (!narrow || compactSettled) return;
    compactSettled = true;
    if (!snap.sidebarCollapsed) c.toggleSidebar(false);
    if (!snap.previewCollapsed) c.togglePreview(false);
  }, [c, narrow, snap.previewCollapsed, snap.sidebarCollapsed]);

  // Home hands focus back to the workspace when it closes (issue #212). The tracker has to
  // be listening before Home makes the shell inert, because the inert blur is what loses
  // the opener.
  useEffect(() => trackWorkspaceFocus(), []);

  // Mirror next-themes' resolved theme onto the editor + terminals, which manage
  // their own (non-CSS) theming.
  const appearance = appearanceOf(theme, resolvedTheme, systemTheme);
  useEffect(() => {
    c.applyUiTheme(appearance);
  }, [c, appearance]);

  // The global chord dispatcher (issue #223). Every binding is an entry in shortcuts.ts and the
  // active context decides whether it may fire: form fields keep their keys, dialogs and
  // blocking overlays own theirs, and the entries that name a surface (the terminal for the
  // Alt chords, the editor and the terminal for the lens picker) defer to it. Capture phase,
  // because Monaco's keybinding service listens on its own DOM and would win a window bubble.
  useEffect(() => {
    const selectTab = (position: number): void => {
      const next = snap.openTabs[position] ?? null;
      if (next !== null) c.openFile(next, { preview: next === snap.previewTab, focus: false });
    };
    const cycleTab = (delta: -1 | 1): void => {
      const next = nextTabId(snap.openTabs, snap.activeTab, delta);
      if (next !== null) c.openFile(next, { preview: next === snap.previewTab, focus: false });
    };
    const actions: Record<ShortcutId, () => void> = {
      "word-wrap": () => c.toggleWordWrap(),
      "tab-select-1": () => selectTab(0),
      "tab-select-2": () => selectTab(1),
      "tab-select-3": () => selectTab(2),
      "tab-select-4": () => selectTab(3),
      "tab-select-5": () => selectTab(4),
      "tab-select-6": () => selectTab(5),
      "tab-select-7": () => selectTab(6),
      "tab-select-8": () => selectTab(7),
      "tab-select-9": () => selectTab(8),
      "tab-previous": () => cycleTab(-1),
      "tab-next": () => cycleTab(1),
      "view-explorer": () => c.setActiveView("explorer"),
      "view-search": () => c.setActiveView("search"),
      "view-source-control": () => c.setActiveView("scm"),
      "palette-command": () => c.openPalette("command"),
      "palette-file": () => c.openPalette("file"),
      "panel-toggle": () => c.togglePanel(),
      "panel-toggle-backtick": () => c.togglePanel(),
      "preview-toggle": () => c.togglePreview(),
      "sidebar-toggle": () => c.toggleSidebar(),
      "file-save": () => c.saveActiveFile(),
      "terminal-new": () => c.terminals.newShellTerminal(),
      "graph-lens": () => lensShortcuts.openPicker(),
      "shortcuts-help": () => shortcutHelpUi.open(),
      // The browser never delivers these to the page, so the registry only documents them.
      "browser-close-tab": () => {},
      "browser-cycle-tabs": () => {},
    };
    const onKey = (event: KeyboardEvent): void => {
      const focus = readShortcutFocus(event.target);
      // A focused form field keeps every chord: the palette's input, a rename box and a
      // dialog's search all type characters that must not become commands.
      if (focus.editing) return;
      const entry = matchShortcut(event, shortcutContext(focus));
      if (entry === null) return;
      event.preventDefault();
      actions[entry.id]();
    };
    addEventListener("keydown", onKey, true);
    return () => removeEventListener("keydown", onKey, true);
  }, [c, lensShortcuts.openPicker, snap.activeTab, snap.openTabs, snap.previewTab]);

  // Guard the browser tab close (⌘W / ⌃W): browsers reserve that shortcut, so we
  // can't repurpose it to close an editor tab — instead warn before the whole
  // session (VFS + running dev server) is torn down. Only nag once a project is
  // live or there are unsaved edits.
  useEffect(() => {
    const shouldWarn = snap.projectTitle != null || snap.dirty.length > 0;
    if (!shouldWarn) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    addEventListener("beforeunload", onBeforeUnload);
    return () => removeEventListener("beforeunload", onBeforeUnload);
  }, [snap.projectTitle, snap.dirty.length]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden text-foreground">
      {/* Only the workspace goes inert: Home, the tour and the boot/share overlays are
          siblings of this frame and must keep working while they cover it. */}
      <WorkspaceFrame view={snap.view}>
        <TitleBar />
        {narrow ? (
          <NarrowShell chatEnabled={chatEnabled} />
        ) : (
          <DesktopShell chatEnabled={chatEnabled} />
        )}
        <StatusBar />
      </WorkspaceFrame>
      <TourHost />
      <CommandPalette />
      <GraphLensPicker
        open={lensShortcuts.pickerOpen}
        onClose={lensShortcuts.closePicker}
        controller={c}
      />
      <ShortcutHelpDialog open={helpOpen} onClose={shortcutHelpUi.close} />
      <ImportRemoteDialog />
      <ResetEverythingDialog />
      <PushRemoteDialog />
      <GitRemoteDialog />
      <ScaffoldTemplateDialog />
      <RunOnDeviceDialog />
      {/* Home overlays the (kept-mounted) IDE so the editor/terminals survive a
          round-trip to Home and back. */}
      {snap.view === "home" && <HomeView />}
      {/* The reload of a tab that has a project boots straight into it: this covers the
          gap until the project is open, instead of flashing Home. */}
      {snap.bootProject !== null && <ProjectBootOverlay />}
      {/* Full-screen blocking spinner while a shared link bootstraps (over the
          workspace, since a #share= link never lands on Home). */}
      {snap.shareLoading && <ShareLoadingOverlay />}
    </div>
  );
}
