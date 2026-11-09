// The preview panel strings, spread into `en` in en.ts.
//
// Keys stay flat and namespace-first, like every other feature block. The module exists so
// the catalogue aggregator stays under the 300-line source limit; the panel itself lives in
// PreviewPanel.tsx and PreviewEmptyState.tsx.
export const previewEn = {
  "preview.empty": "No preview open.",
  "preview.emptyTab": "Empty tab — type a local address like localhost:3000 and press Enter.",
  "preview.runProject": "Run project",
  "preview.startFailed": "The project did not start.",
  "preview.progressHint":
    "The preview appears as soon as the dev server binds a port. Watch the terminal for detail.",
  "preview.retry": "Try again",
  "preview.newTab": "New browser tab",
  "preview.tabTitle": "Preview ({port})",
  "preview.untitledTab": "New tab",
  "preview.close": "Close",
  "preview.closeOthers": "Close others",
  "preview.closeRight": "Close to the right",
  "preview.closeAll": "Close all",
  "preview.back": "Back",
  "preview.forward": "Forward",
  "preview.reload": "Reload",
  "preview.openDevtools": "Open devtools",
  "preview.closeDevtools": "Close devtools",
  "preview.openExternal": "Open in a new tab",
  "preview.address": "Local address",
  "preview.devtoolsTitle": "DevTools",
} as const;
