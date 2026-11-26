// Bottom panel, status bar and run controls (D-124). Split out of en.ts so the catalogue
// stays under the 300-line source limit as more features land, following the same pattern as
// en-project-graph.ts and the other feature modules.
export const runEn = {
  // ── bottom panel + status bar (D-124) ────────────────────────────────────
  // The panel is closed by default and its three surfaces are opened from the
  // status bar, so these labels are the panel's only tab strip.
  "panel.console": "Console",
  "panel.terminal": "Terminal",
  "panel.ports": "Ports",
  "panel.openConsole": "Show console",
  "panel.openTerminal": "Show terminal",
  "panel.openPorts": "Show ports",
  "panel.hide": "Hide panel",
  "panel.newTerminal": "New terminal",
  "panel.noTerminals": "No terminals. Press + to create one.",
  "panel.killTerminal": "Kill terminal",
  "panel.noPorts": "No ports are forwarded. Run a project to start a server.",
  "panel.port": "Port",
  "panel.process": "Process",
  "panel.address": "Address",
  "panel.openPreview": "Open preview",

  // ── run (the status bar's Play/Stop control) ────────────────────────────
  "run.start": "Run",
  "run.noProject": "Open a project first.",
  "run.startHint": "Install dependencies and start this project",
  "run.stop": "Stop",
  "run.stopHint": "Stop the dev server",
  "run.running": "Running",
  "run.runningHint": "Show the running app",
  "run.failed": "Start failed",
  "run.failedHint": "The project did not start — open the terminal to see why",
  "run.showTerminal": "Show terminal",

  // ── the device confirmation before install + dev server (run-consent.ts) ──
  "run.confirm.title": "Start the dev server on this device?",
  "run.confirm.body":
    "This device has limited memory for running a project in the browser. The graph, the editor and the files work without it.",
  "run.confirm.costInstall": "Downloads the project's dependencies from npm.",
  "run.confirm.costMemory": "The dev server can take close to a gigabyte of memory in this tab.",
  "run.confirm.costTime": "The first start can take minutes, and the browser may close the tab.",
  "run.confirm.start": "Start anyway",
  "run.confirm.notNow": "Not now",

  // ── the narrow shell's bottom navigation (below 1024px, issue #195) ──────
  "shell.mobile.files": "Files",
  "shell.mobile.code": "Code",
  "shell.mobile.preview": "Preview",
} as const;
