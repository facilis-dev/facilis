// The Logs panel strings (D-119), spread into `en` in en.ts.
//
// Keys stay flat and namespace-first, like every other feature block. The panel is
// read-only: access/audit/error/app JSONL files under <projectRoot>/.facilis/logs, read
// through the kernel VFS (there is deliberately no log HTTP endpoint).
export const logsEn = {
  "activity.logs": "Logs",

  "logs.title": "Logs",
  "logs.refresh": "Refresh logs",
  "logs.autoRefresh": "Auto-refresh every 2 seconds",
  "logs.openInEditor": "Open in editor",
  "logs.loading": "Reading log files…",
  "logs.noProject": "Open a project to inspect its logs.",
  "logs.empty": "No log files yet",
  "logs.emptyHint":
    "Logs are JSONL files in {path}. They appear once the project handles a request.",
  "logs.error": "Could not read the logs: {error}",
  "logs.retry": "Try again",
  "logs.files": "Log files",
  "logs.selectFile": "Select a log file to see its rows.",
  "logs.filterText": "Filter rows…",
  "logs.filterKind": "Kind",
  "logs.filterLevel": "Level",
  "logs.filterAll": "All",
  "logs.kind.access": "Access",
  "logs.kind.audit": "Audit",
  "logs.kind.error": "Error",
  "logs.kind.app": "App",
  "logs.kind.unknown": "Unknown",
  "logs.level.debug": "Debug",
  "logs.level.info": "Info",
  "logs.level.warn": "Warn",
  "logs.level.error": "Error",
  "logs.level.unknown": "Unknown",
  "logs.count": "{shown} of {total} row(s)",
  "logs.truncated": "Showing the last {kib} KiB of this file.",
  "logs.corrupt": "Unparseable line",
  "logs.timeUtc": "Time (UTC)",
  "logs.sizeUnknown": "unknown size",
  "logs.emptyFiltered": "No rows match the filters.",
  "logs.noRows": "No rows in this file yet.",
} as const;
