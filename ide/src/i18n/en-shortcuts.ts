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
  "shortcuts.closeTab": "Close editor tab",
  "shortcuts.cycleTabs": "Cycle editor tabs",
  "shortcuts.note.browserKeeps": "The browser keeps this shortcut; the IDE cannot bind it.",
} as const;
