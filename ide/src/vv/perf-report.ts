// What a capture turns into: one Markdown file, ready to paste into a bug report, with the
// raw JSON in a fenced block at the end so a maintainer can read the human half and still
// parse the machine one.
//
// English on purpose: this file is an artifact for an issue against the kernel, not UI
// chrome, and a translated stack trace is worse than none. The UI strings around it (the
// status-bar entry, the toast) do go through t().

import { downloadBlob } from "./project-export";
import type { PerfSnapshot } from "./perf-capture";

const FENCE = "```";

const MS = (value: number | null): string => (value === null ? "—" : Math.round(value) + " ms");

function bytes(value: number | null): string {
  if (value === null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return (unit === 0 ? Math.round(amount) : amount.toFixed(1)) + " " + units[unit];
}

const seconds = (value: number | null): string =>
  value === null ? "—" : (value / 1000).toFixed(1) + " s";

/** How a verdict reads in the report: the sentence a maintainer quotes back. */
function verdictLine(snapshot: PerfSnapshot): string {
  const { fs } = snapshot;
  if (fs.verdict === "healthy") {
    return "healthy — the filesystem answers as fast as a machine that is not in trouble";
  }
  if (fs.verdict === "degraded") return "degraded — slower than a healthy machine, still answering";
  if (fs.verdict === "saturated") {
    return (
      "saturated — the probe round-trip is the queue every syscall waits in, so a " +
      "dev-server boot asking for hundreds of files pays it per request: expect a " +
      "multi-minute boot and module-runner timeouts at the 60 s budget"
    );
  }
  return "unknown — no probe answered and none timed out";
}

function marksLine(marks: { name: string; t: number }[]): string {
  if (marks.length === 0) return "none recorded";
  return marks.map((mark) => mark.name + "@" + Math.round(mark.t) + "ms").join(", ");
}

function sampleRows(snapshot: PerfSnapshot): string[] {
  const rows = snapshot.samples.slice(-60);
  if (rows.length === 0) return ["| — | — | — | — |"];
  return rows.map(
    (sample) =>
      "| " +
      sample.t +
      " | " +
      MS(sample.rttMs) +
      " | " +
      (sample.files ?? "—") +
      " | " +
      (sample.deferred ?? "—") +
      " |",
  );
}

function procRows(snapshot: PerfSnapshot): string[] {
  if (snapshot.procs.length === 0) return ["| — | — | — | — | — |"];
  return snapshot.procs.map(
    (proc) =>
      "| " +
      proc.pid +
      " | " +
      proc.command +
      " | " +
      seconds(proc.sinceOutputMs) +
      " | " +
      proc.syscalls +
      " | " +
      (proc.booted ? "yes" : "no") +
      " |",
  );
}

/** The document, rendered from the snapshot alone: no clock, no browser, so a test can pin it. */
export function renderSnapshot(snapshot: PerfSnapshot): string {
  const { device, boot, fs, vfs } = snapshot;
  const lines: string[] = [
    "## Facilis performance snapshot",
    "",
    "Captured " + snapshot.capturedAt + " from the IDE (the whole VM runs in this browser tab).",
    "",
    "### Environment",
    "",
    "- UA: " + device.userAgent,
    "- platform: " + device.platform,
    "- cores: " +
      (device.cores ?? "—") +
      " · deviceMemory: " +
      (device.deviceMemoryGb ?? "—") +
      " GB",
    "- page heap: " + bytes(device.pageHeapBytes) + " / " + bytes(device.heapLimitBytes),
    "- storage: " + bytes(device.storageUsedBytes) + " / " + bytes(device.storageQuotaBytes),
    "- boot (kernel-online to preview-paint): " + seconds(boot.bootMs),
    "- marks: " + marksLine(boot.marks),
    "",
    "### FS answer latency (__vv.diag() round-trip — the same queue as every syscall)",
    "",
    "- probes " + fs.probes + " (answered " + fs.answered + ", timeouts " + fs.timeouts + ")",
    "- p50 " + MS(fs.p50Ms) + " · p95 " + MS(fs.p95Ms) + " · max " + MS(fs.maxMs),
    "- verdict: **" + verdictLine(snapshot) + "**",
    "- healthy baseline measured in this IDE on an idle machine: ~105 ms",
    "",
    "| t (ms) | rtt | files | deferred |",
    "|---|---|---|---|",
    ...sampleRows(snapshot),
    "",
    "### VFS across the window",
    "",
    "- files " +
      (vfs.filesStart ?? "—") +
      " to " +
      (vfs.filesEnd ?? "—") +
      " · deferred " +
      (vfs.deferredStart ?? "—") +
      " to " +
      (vfs.deferredEnd ?? "—") +
      " · changed during the window: " +
      (vfs.changed ? "yes" : "no"),
    "",
    "### Guest processes",
    "",
    "| pid | command | silent | syscalls | booted |",
    "|---|---|---|---|---|",
    ...procRows(snapshot),
    "",
    "### Terminal (tail)",
    "",
    FENCE,
    ...(snapshot.terminal.length ? snapshot.terminal : ["(empty)"]),
    FENCE,
    "",
    "### What this file cannot tell you",
    "",
    "Worker stacks and per-thread CPU are not observable from the page. Chrome Task Manager",
    "(Shift+Esc: the fs-worker entry at 100% means a busy thread, 0% means parked on OPFS) and",
    "a paused stack from chrome://inspect are still a manual step.",
    "",
    "### Raw snapshot",
    "",
    FENCE + "json",
    JSON.stringify(snapshot, null, 2),
    FENCE,
    "",
  ];
  return lines.join("\n");
}

/** facilis-perf-2026-11-15T14-30-00.md: sortable, and safe on every filesystem. */
export function snapshotFilename(snapshot: PerfSnapshot): string {
  return "facilis-perf-" + snapshot.capturedAt.replace(/[:.]/g, "-") + ".md";
}

/** Renders and saves the report. One file: the readable half already carries the raw JSON. */
export function downloadSnapshot(snapshot: PerfSnapshot): string {
  const name = snapshotFilename(snapshot);
  downloadBlob(new Blob([renderSnapshot(snapshot)], { type: "text/markdown" }), name);
  return name;
}
