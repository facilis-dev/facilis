// Editor tab strip strings, spread into `en` in en.ts.
//
// The strip moved out of EditorGroup.tsx into its own module (issue #214), so every
// string it renders lives here: the tablist label, the dirty state a screen reader
// announces, the context menu and the tab rows in the command palette.
export const editorTabsEn = {
  "editorTabs.label": "Open editors",
  "editorTabs.tabDirty": "{name} (unsaved changes)",
  "editorTabs.closeNamed": "Close {name}",
  "editorTabs.menu.closeOthers": "Close Others",
  "editorTabs.menu.closeRight": "Close to the Right",
  "editorTabs.menu.closeSaved": "Close Saved",
  "editorTabs.menu.closeAll": "Close All",
  "editorTabs.next": "Next Editor Tab",
  "editorTabs.previous": "Previous Editor Tab",
  "editorTabs.closeOthers": "Close Other Editor Tabs",
  "editorTabs.closeRight": "Close Editor Tabs to the Right",
  "editorTabs.closeAll": "Close All Editor Tabs",
} as const;
