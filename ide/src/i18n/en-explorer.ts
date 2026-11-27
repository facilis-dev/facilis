// Explorer (file tree) strings, spread into `en` in en.ts.
//
// The tree was upstream-inherited; the row context menu and the tree itself moved
// into their own modules (issue #209), so every string this surface renders lives
// here and a theme/locale change never leaves a literal behind.
export const explorerEn = {
  "explorer.title": "Workspace",
  "explorer.tree.label": "Files",
  "explorer.newFile": "New File",
  "explorer.newFolder": "New Folder",
  "explorer.refresh": "Refresh",
  "explorer.collapseAll": "Collapse Folders in Workspace",
  "explorer.empty": "No folder open. Go",
  "explorer.home": "Home",
  "explorer.emptyTail": "to create or open a project.",
  "explorer.delete.title": "Delete permanently?",
  "explorer.delete.items": "{count} items",
  "explorer.delete.tail": "will be permanently removed. This cannot be undone.",
  "explorer.delete.action": "Delete",
  "explorer.menu.open": "Open",
  "explorer.menu.newFile": "New File…",
  "explorer.menu.newFolder": "New Folder…",
  "explorer.menu.terminal": "Open in Integrated Terminal",
  "explorer.menu.copyPath": "Copy Path",
  "explorer.menu.exportZip": "Export as Zip…",
  "explorer.menu.share": "Share (copy link)",
  "explorer.menu.rename": "Rename",
  "explorer.menu.copy": "Copy",
  "explorer.menu.cut": "Cut",
  "explorer.menu.paste": "Paste",
  "explorer.menu.closeFolder": "Close Folder",
  "explorer.menu.delete": "Delete permanently",
} as const;
