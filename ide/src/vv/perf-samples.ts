// The sample math behind a performance snapshot: what one `__vv.diag()` probe says, and
// what a window of them says. Pure on purpose — every rule here is pinned by a test, and the
// capture (perf-capture.ts) only decides when to call it.
//
// Why the round-trip is the metric: `__vv.diag()` goes through the same doorbell queue that
// serves every filesystem syscall, so its latency is that queue's latency. On a real warm-boot
// hang it measured 2008 ms / 2016 ms against a ~105 ms baseline; a dev-server boot asks for
// hundreds of files, so the per-request number — not the boot duration — is the one that
// explains a stall.

/** Marks the IDE already records (boot-marks.ts), read back here without importing React. */
export interface BootMark {
  name: string;
  t: number;
}

/** One probe: the round-trip and the counters that came back with it. */
export interface PerfSample {
  /** performance.now() at the start of the probe. */
  t: number;
  /**
   * Filesystem round-trip in ms (`vv-stat` on the VFS root): page → kernel → FS worker and
   * back, the queue every syscall waits in. Null means it timed out — itself a measurement.
   */
  rttMs: number | null;
  /**
   * `__vv.diag()` round-trip, kept separate because it is NOT a pure FS probe: the kernel
   * queries per-process heaps with a hardcoded 2 s budget, so a diag that takes ~2 s means a
   * guest process did not answer — i.e. one is parked, not that the FS is slow.
   */
  diagMs: number | null;
  files: number | null;
  bytes: number | null;
  deferred: number | null;
  /** Longest `sinceOutputMs` across the guest processes at this instant. */
  silentMaxMs: number | null;
  /**
   * How long a zero-delay timer took to fire just before the probe: the page's own event
   * loop. Without it a slow round-trip could be blamed on the FS worker when the main thread
   * is the one that never yielded.
   */
  pageLagMs: number | null;
}

export interface GuestProc {
  pid: number;
  command: string;
  sinceOutputMs: number;
  syscalls: number;
  booted: boolean;
  /** -1 is the kernel's sentinel for "did not answer the 2 s heap query": a parked process. */
  heapBytes: number | null;
}

/** What a verdict means, in the order a maintainer reads it. */
export type PerfVerdict = "healthy" | "degraded" | "saturated" | "unknown";

export interface FsLatency {
  probes: number;
  answered: number;
  timeouts: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  verdict: PerfVerdict;
}

export interface VfsTrend {
  filesStart: number | null;
  filesEnd: number | null;
  deferredStart: number | null;
  deferredEnd: number | null;
  /** Whether any counter moved across the window: the witness that work is landing. */
  changed: boolean;
}

/**
 * The thresholds, named so a test can pin them and a reviewer can argue with them. The
 * healthy/degraded boundary is the one that separated a working boot (~105 ms) from the
 * report above (2008 ms); 250 ms keeps a merely busy machine out of the alarm.
 */
export const PERF_LIMITS = {
  sampleIntervalMs: 1_000,
  /** Five minutes of boot, then stop sampling: a tab left open must not probe forever. */
  maxSamples: 300,
  /** Probes kept after the first paint, so the settled state is in the report too. */
  afterPaintSamples: 3,
  /** A probe slower than this is recorded as a timeout, not waited on forever. */
  probeTimeoutMs: 10_000,
  healthyRttMs: 250,
  degradedRttMs: 1_000,
  /** How many probes a capture takes right now, so the report has current numbers. */
  burstProbes: 5,
  /** Rows of each terminal kept in the report. */
  terminalLines: 200,
} as const;

/** Just enough of xterm to read scrollback, so this module does not depend on it. */
export interface ScrollbackTerminal {
  buffer: {
    active: {
      length: number;
      getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined;
    };
  };
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asString = (value: unknown): string => (typeof value === "string" ? value : "");

export interface DiagFacts {
  /** False when the kernel answered "not ready": that probe measured nothing. */
  ready: boolean;
  files: number | null;
  bytes: number | null;
  deferred: number | null;
  silentMaxMs: number | null;
  procs: GuestProc[];
}

/** Diag replies are a protocol, not a contract: read them defensively. */
export function readDiag(reply: unknown): DiagFacts {
  const root = asRecord(reply);
  const vfs = asRecord(root?.vfs);
  const rawProcs = Array.isArray(root?.procs) ? root.procs : [];
  const procs: GuestProc[] = [];
  for (const entry of rawProcs) {
    const proc = asRecord(entry);
    if (!proc) continue;
    procs.push({
      pid: asNumber(proc.pid) ?? -1,
      command: asString(proc.command),
      sinceOutputMs: asNumber(proc.sinceOutputMs) ?? 0,
      syscalls: asNumber(proc.syscalls) ?? 0,
      booted: proc.booted === true,
      heapBytes: asNumber(proc.heapBytes),
    });
  }
  const silent = procs.map((proc) => proc.sinceOutputMs);
  return {
    ready: root !== null && typeof root.error !== "string",
    files: asNumber(vfs?.files),
    bytes: asNumber(vfs?.bytes),
    deferred: asNumber(vfs?.deferred),
    silentMaxMs: silent.length ? Math.max(...silent) : null,
    procs,
  };
}

/** Nearest-rank percentile over the answered probes; null when there is nothing to rank. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank] ?? null;
}

export function classifyLatency(p50Ms: number | null, timeouts: number): PerfVerdict {
  if (p50Ms === null) return timeouts > 0 ? "saturated" : "unknown";
  if (p50Ms <= PERF_LIMITS.healthyRttMs) return "healthy";
  if (p50Ms <= PERF_LIMITS.degradedRttMs) return "degraded";
  return "saturated";
}

export function summarizeLatency(samples: readonly PerfSample[]): FsLatency {
  const answered = samples
    .map((sample) => sample.rttMs)
    .filter((value): value is number => typeof value === "number");
  const timeouts = samples.filter((sample) => sample.rttMs === null).length;
  const p50Ms = percentile(answered, 50);
  return {
    probes: samples.length,
    answered: answered.length,
    timeouts,
    p50Ms,
    p95Ms: percentile(answered, 95),
    maxMs: answered.length ? Math.max(...answered) : null,
    verdict: classifyLatency(p50Ms, timeouts),
  };
}

export function vfsTrend(samples: readonly PerfSample[]): VfsTrend {
  const first = samples[0];
  const last = samples[samples.length - 1];
  const filesStart = first?.files ?? null;
  const filesEnd = last?.files ?? null;
  const deferredStart = first?.deferred ?? null;
  const deferredEnd = last?.deferred ?? null;
  return {
    filesStart,
    filesEnd,
    deferredStart,
    deferredEnd,
    changed:
      filesStart !== filesEnd ||
      deferredStart !== deferredEnd ||
      (first?.bytes ?? null) !== (last?.bytes ?? null),
  };
}

/** Rows of a terminal's scrollback, oldest first: the tail is where the failure is. */
export function terminalTail(
  term: ScrollbackTerminal,
  lines: number = PERF_LIMITS.terminalLines,
): string[] {
  const buffer = term.buffer.active;
  const from = Math.max(0, buffer.length - lines);
  const out: string[] = [];
  for (let index = from; index < buffer.length; index += 1) {
    out.push(buffer.getLine(index)?.translateToString(true) ?? "");
  }
  return out;
}
