// The guided-tour strings (D-128), spread into `en` in en.ts. The main catalogue keeps
// room for shared chrome; a feature block lives in its own module, like en-project-graph.ts.
export const tourEn = {
  "tour.dialogAria": "Guided tour of the IDE",
  "tour.stepOf": "Step {current} of {total}",
  "tour.next": "Next",
  "tour.back": "Back",
  "tour.skip": "Skip tour",
  "tour.done": "Got it",
  "tour.helpAria": "Open the guided tour",

  "tour.step.graph.title": "The project, at the center",
  "tour.step.graph.body":
    "A Facilis project opens here: pages, routes and tables as one graph. Drag a node to arrange it, double-click to open its source.",
  "tour.step.activity.title": "The activity bar",
  "tour.step.activity.body":
    "This is how you change surface: workspace, search, git, run and debug, data, release, logs and AI chat. The graph stays one click away.",
  "tour.step.explorer.title": "Files, at a glance",
  "tour.step.explorer.body":
    "The Explorer is the classic map of the project: every file with its git state and the right icon. It also handles drag-and-drop and rename.",
  "tour.step.chat.title": "Your AI pair",
  "tour.step.chat.body":
    "The chat reads the project and proposes patches: describe the change, review the diff, apply it. It can also see the running preview.",
  "tour.step.preview.title": "The app, live",
  "tour.step.preview.body":
    "The dev server runs in this tab: save a file and the preview updates. The layout buttons in the top bar show or hide this panel.",
  "tour.step.console.title": "Console and terminal",
  "tour.step.console.body":
    "The bottom panel: dev-server output, a real terminal inside the WebContainer, and the ports the app is listening on.",
  "tour.step.status.title": "The status bar",
  "tour.step.status.body":
    "Git branch, diagnostics and the cursor position, always visible. Click an item to act on it.",
  "tour.step.finale.title": "That is the tour",
  "tour.step.finale.body":
    "Replay it any time from the ? button in the top bar or from the command palette (⌘K). Everything else is learned by using it.",
} as const;
