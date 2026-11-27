import { useEffect, useLayoutEffect } from "react";
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
import { useIde } from "./useIde";
import { aiAvailable, deployment } from "@/deploy/current";
import { isWordWrapChord } from "@/vv/editor-prefs";
import { nextTabId, tabShortcutIntent } from "./editor-tabs";
import { useNarrowShell } from "@/vv/narrow-shell";

// Once per page load: the compact defaults are applied on the first narrow render
// only, so dragging the window across the breakpoint keeps the user's own layout.
let compactSettled = false;

export function AppShell() {
  const { c, snap } = useIde();
  const lensShortcuts = useGraphLensShortcuts();
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

  // Mirror next-themes' resolved theme onto the editor + terminals, which manage
  // their own (non-CSS) theming.
  const appearance = appearanceOf(theme, resolvedTheme, systemTheme);
  useEffect(() => {
    c.applyUiTheme(appearance);
  }, [c, appearance]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Alt+Z / ⌥Z, ABOVE the ⌘/Ctrl gate below, because it is the one binding here
      // with no ⌘/Ctrl in it. Monaco embedded on its own has no such keybinding — Alt+Z
      // is VS Code's, a layer this app does not have — so there is nothing to inherit
      // and the shortcut has to be declared here.
      //
      // NOT with editor.addCommand: that would only fire while the editor has focus,
      // and VS Code's is global. One window listener also covers the diff editor for
      // free, and keeps the matching in one place rather than depending on how Monaco
      // resolves an Option chord on a macOS layout.
      //
      // preventDefault matters on macOS even outside the editor: ⌥Z composes "Ω", and
      // an editor with focus would otherwise type it into the file.
      if (isWordWrapChord(e)) {
        // …but not while a terminal has focus, because the key belongs to whatever the
        // cursor is in and word wrap does nothing to a terminal. What it means there
        // differs by platform: on Windows and Linux Alt+<key> is the meta prefix
        // readline reads as ESC z, which is genuinely the shell's; on macOS it is NOT,
        // since xterm defaults macOptionIsMeta to false and makeTerm does not change
        // it, so the shell just receives the composed "Ω". That second case is how
        // every Option chord has always behaved here and is not this shortcut's to
        // fix — but neither is it a reason to take the key. The palette entry reaches
        // word wrap from a terminal. Mirror of the terminal's own ⌘K, which is scoped
        // to the focused xterm so it never clobbers the editor (see makeTerm).
        if (document.activeElement?.closest(".vv-term-host")) return;
        e.preventDefault();
        c.toggleWordWrap();
        return;
      }
      // Editor tab chords, also above the ⌘/Ctrl gate: the direct ones are Alt-only.
      // Ctrl+Tab, Ctrl+Shift+Tab and Ctrl+PageUp/PageDown are reserved by Chrome, Safari
      // and Edge and never reach the page — the same reason Ctrl+W is not repurposed
      // below — so the delivered chords are Alt+1…9 (select by position) and
      // Ctrl+Alt+Left/Right (previous/next). A desktop environment can still claim the
      // latter for workspace switching; the direct chords and the palette are the
      // fallback, and all of them are listed in the palette. This handler is the
      // shortcut registry.
      //
      // The terminal owns Alt+<key> (readline's meta prefix on Windows/Linux, the Option
      // composition on macOS), so the chords defer there the way word wrap does.
      const tabShortcut = tabShortcutIntent(e);
      if (tabShortcut && !document.activeElement?.closest(".vv-term-host")) {
        e.preventDefault();
        const next =
          tabShortcut.kind === "select"
            ? (snap.openTabs[tabShortcut.index] ?? null)
            : nextTabId(snap.openTabs, snap.activeTab, tabShortcut.delta);
        if (next !== null) c.openFile(next, { preview: next === snap.previewTab, focus: false });
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (e.shiftKey && k === "e") {
        e.preventDefault();
        c.setActiveView("explorer");
      } else if (e.shiftKey && k === "f") {
        e.preventDefault();
        c.setActiveView("search");
      } else if (e.shiftKey && k === "g") {
        e.preventDefault();
        c.setActiveView("scm");
      } else if (e.shiftKey && k === "p") {
        e.preventDefault();
        c.openPalette("command");
      } else if (k === "p") {
        e.preventDefault();
        c.openPalette("file");
      } else if (k === "`") {
        e.preventDefault();
        c.togglePanel();
      } else if (e.altKey && (k === "b" || e.code === "KeyB")) {
        // VS Code's secondary side bar shortcut, mapped to the preview. Matched on
        // `code` as well as `key` because holding Option on macOS can compose the
        // character (⌥B → "∫"), which would otherwise miss and fall through to the
        // plain ⌘B branch below and toggle the wrong panel.
        e.preventDefault();
        c.togglePreview();
      } else if (k === "b") {
        e.preventDefault();
        c.toggleSidebar();
      } else if (k === "j") {
        e.preventDefault();
        c.togglePanel();
      } else if (k === "s") {
        e.preventDefault();
        c.saveActiveFile();
      } else if (e.shiftKey && k === "c") {
        e.preventDefault();
        c.terminals.newShellTerminal();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [c, snap.openTabs, snap.activeTab, snap.previewTab]);

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
      <TitleBar />
      {narrow ? (
        <NarrowShell chatEnabled={chatEnabled} />
      ) : (
        <DesktopShell chatEnabled={chatEnabled} />
      )}
      <StatusBar />
      <TourHost />
      <CommandPalette />
      <GraphLensPicker
        open={lensShortcuts.pickerOpen}
        onClose={lensShortcuts.closePicker}
        controller={c}
      />
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
