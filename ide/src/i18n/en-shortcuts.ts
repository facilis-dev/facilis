// Shortcut labels (issue #223). A per-feature catalogue because en.ts is at its 300-line cap:
// the registry's labelKey values are typed against the English catalogue, so a key added there
// and missing here is a typecheck error, not a silent label.
export const shortcutsEn = {
  "shortcuts.wordWrap": "Toggle Word Wrap",
  "shortcuts.tabSelect": "Select tab {index}",
  "shortcuts.tabPrevious": "Previous editor tab",
  "shortcuts.tabNext": "Next editor tab",
  "shortcuts.explorer": "Show Explorer",
  "shortcuts.search": "Show Search",
  "shortcuts.sourceControl": "Show Source Control",
  "shortcuts.commandPalette": "Command Palette",
  "shortcuts.filePalette": "Quick Open file",
  "shortcuts.togglePanel": "Toggle panel",
  "shortcuts.togglePreview": "Toggle Preview Panel",
  "shortcuts.sidebarToggle": "Toggle Sidebar",
  "shortcuts.save": "Save File",
  "shortcuts.newTerminal": "New Terminal",
  "shortcuts.graphLens": "Graph lens picker",
  "shortcuts.help": "Keyboard Shortcuts",
  "shortcuts.closeTab": "Close editor tab",
  "shortcuts.cycleTabs": "Cycle editor tabs",
  "shortcuts.note.browserKeeps": "The browser keeps this shortcut; the IDE cannot bind it.",
  "shortcuts.tourDismiss": "End the guided tour",
  "shortcuts.tourNext": "Next tour step",
  "shortcuts.tourPrevious": "Previous tour step",
  "shortcuts.note.tourKeeps": "The tour keeps this key while it is open.",

  // The help surface itself.
  "shortcuts.dialogTitle": "Keyboard Shortcuts",
  "shortcuts.dialogHint":
    "Global bindings from the IDE registry, in this platform's spelling. Press ? when no editable field has focus to open this list.",
  "shortcuts.group.global": "Global",
  "shortcuts.group.editor": "Editor",
  "shortcuts.group.terminal": "Terminal",
  "shortcuts.group.dialog": "Dialogs",
  "shortcuts.group.overlay": "Overlays",
  "shortcuts.group.browser": "Reserved by the browser",
  "shortcuts.close": "Close",
  "shortcuts.notInRegistry.title": "Not in this list",
  "shortcuts.notInRegistry.escape":
    "Escape closes the surface that is open — a dialog, the project-graph drawer and card, or the narrow drawer — and that ladder belongs to the surface; the tour's own keys are listed under Overlays.",
  "shortcuts.notInRegistry.editors":
    "The code editor and the terminal keep their own keys: Monaco's editor commands and the terminal's clear and run keys act on the focused surface, so they are not listed here.",
} as const;
