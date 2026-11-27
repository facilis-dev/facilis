// Status-bar strings, spread into the `en` catalogue in en.ts. The bar is a surface of its own; the keyboard names it gained in #225 push the core file past its 300-line cap.
export const statusEn = {
  "status.goToLineDialog": "Go to Line",
  "status.goToLineHint": "Type a line number between 1 and {count} to navigate to.",
  "status.indentationDialog": "Indentation",
  "status.languageModeDialog": "Select Language Mode",
  "status.languageModeEmpty": "No matching language mode.",
  "status.languageAuto": "Auto Detect",
  "status.branch": "Current branch",
  "status.frameworkPackages":
    "Minimum @facilis.dev/* versions this build requires (core {version}) — new projects pin each package exactly: {packages}",
  "status.goToLine": "Go to Line/Column",
  "status.indent": "Select indentation",
  "status.language": "Select language mode",
  "status.python": "Python language service (jedi, black)",
  "status.position": "Ln {line}, Col {column}",
  "status.error": "error",
  "status.errors": "errors",
  "status.warning": "warning",
  "status.warnings": "warnings",
  "status.selections": "({count} selections)",
  "status.selected": "({count} selected)",
  // Device health (device-health.ts): one readout per issue the signals warrant.
  "status.device.memoryPressure": "Memory pressure",
  "status.device.lowMemory": "Low RAM",
  "status.device.slowBoot": "Slow start",
  "status.device.lowStorage": "Storage nearly full",
  "status.device.hint":
    "This tab runs the whole VM. Closing other tabs and apps frees the memory it needs.",
  // Performance snapshot (perf-capture.ts): the artifact a slow boot needs to become a bug.
  "status.perf.capture": "Snapshot",
  "status.perf.capturing": "Capturing…",
  "status.perf.hint":
    "Capture this tab's performance report — FS answer latency, VFS counts, guest processes and the terminal tail — for a bug report",
  "status.perf.saved": "Performance snapshot saved: {file}",
  "status.perf.failed": "The performance snapshot could not be captured.",
} as const;
