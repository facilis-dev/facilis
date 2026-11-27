// Action names for the search result rows and the breakpoint row (issue #215). They have
// their own catalogue because en.ts is at its line cap; the rows moved out of
// SearchPane.tsx and DebugPanel.tsx, which are pinned by the file-length ratchet.
export const panelActionsEn = {
  "search.replaceInFile": "Replace All in File",
  "search.dismiss": "Dismiss",
  "search.replace": "Replace",
  "debug.removeBreakpoint": "Remove breakpoint",
} as const;
