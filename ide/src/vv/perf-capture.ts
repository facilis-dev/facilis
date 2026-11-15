// Collects a performance snapshot from the live IDE: the boot window it already lived
// through plus a burst of probes taken now, so a report describes the stall the user is in
// rather than the machine after it recovers.
//
// The sampler runs off the same probe as the capture, one per second, and stops once the boot
// has painted (plus a few settled samples) or after five minutes: a tab left open must not
// keep asking the kernel anything. Module state on purpose — the status bar mounts, the boot
// happens, the user clicks later, and the report must contain the part that happened before
// the click.

import { bootDurationMs } from "./device-health";
import type { KernelBridge } from "./kernel";
import {
  type BootMark,
  type FsLatency,
  type GuestProc,
  type PerfSample,
  type VfsTrend,
  PERF_LIMITS,
  readDiag,
  summarizeLatency,
  vfsTrend,
} from "./perf-samples";

export interface DeviceFacts {
  userAgent: string;
  platform: string;
  cores: number | null;
  deviceMemoryGb: number | null;
  pageHeapBytes: number | null;
  heapLimitBytes: number | null;
  storageUsedBytes: number | null;
  storageQuotaBytes: number | null;
}

export interface PerfSnapshot {
  schema: 1;
  capturedAt: string;
  device: DeviceFacts;
  boot: { marks: BootMark[]; bootMs: number | null };
  /** p50/p95/max of the probe round-trip plus the verdict. */
  fs: FsLatency;
  vfs: VfsTrend;
  samples: PerfSample[];
  procs: GuestProc[];
  /** Tail of every open terminal, console included. */
  terminal: string[];
}

/** What the capture reads. Every field is injected so the test needs no browser. */
export interface CaptureSources {
  /** `__vv.diag()`: counters and per-process state (NOT a pure latency probe). */
  diag: () => Promise<unknown>;
  /** A filesystem round-trip: `vv-stat` on the VFS root. This is the latency metric. */
  stat: () => Promise<unknown>;
  bootMarks: () => BootMark[];
  terminal: () => string[];
  device: () => DeviceFacts;
  storage: () => Promise<{ usedBytes: number | null; quotaBytes: number | null }>;
  /** Event-loop delay of the page itself, measured with a zero-delay timer. */
  lag: () => Promise<number>;
  now: () => number;
}

const TIMED_OUT = Symbol("timed-out");
type Probe = typeof TIMED_OUT | { reply: unknown };

async function withTimeout(promise: Promise<unknown>, ms: number): Promise<Probe> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([promise.then((reply): Probe => ({ reply })), timeout]);
  } catch {
    // A throwing diag is not a hang; it is recorded as "no answer", which is the same readout.
    return TIMED_OUT;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * One measurement, or null when there is nothing to measure yet: a kernel that answers "not
 * ready" would otherwise record a 1 ms round-trip and drag the p50 towards "healthy".
 */
async function probe(
  sources: CaptureSources,
): Promise<{ sample: PerfSample; procs: GuestProc[] } | null> {
  const pageLagMs = Math.round(await sources.lag());
  const started = sources.now();
  // Two probes, because they answer different questions: the stat is the FS latency, the
  // diag is the counters — and its own 2 s heap budget would otherwise be read as latency.
  const statOk = (await withTimeout(sources.stat(), PERF_LIMITS.probeTimeoutMs)) !== TIMED_OUT;
  const rttMs = statOk ? Math.round(sources.now() - started) : null;
  const diagStarted = sources.now();
  const result = await withTimeout(sources.diag(), PERF_LIMITS.probeTimeoutMs);
  const timedOut = result === TIMED_OUT;
  const facts = readDiag(timedOut ? null : result.reply);
  // A timed-out diag is still evidence; an un-ready kernel is not.
  if (!timedOut && !facts.ready) return null;
  return {
    sample: {
      t: Math.round(started),
      rttMs,
      diagMs: timedOut ? null : Math.round(sources.now() - diagStarted),
      files: facts.files,
      bytes: facts.bytes,
      deferred: facts.deferred,
      silentMaxMs: facts.silentMaxMs,
      pageLagMs,
    },
    procs: facts.procs,
  };
}

// The boot window this tab has already lived through (see the header for why it is module state).
let history: PerfSample[] = [];
let sampling = false;
/** Set while a capture runs, so the sampler does not add probes the burst is already taking. */
let capturing = false;

export function perfHistory(): readonly PerfSample[] {
  return history;
}

/** Test seam: the only reason the history is resettable. */
export function resetPerfHistory(): void {
  history = [];
  sampling = false;
  capturing = false;
}

const painted = (sources: CaptureSources): boolean =>
  sources.bootMarks().some((mark) => mark.name === "preview-paint");

/** Samples once a second until the boot paints (plus a few settled samples) or the cap. */
export function startPerfSampling(sources: CaptureSources): () => void {
  if (sampling) return stopSampling;
  sampling = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let afterPaint = 0;
  const tick = async (): Promise<void> => {
    if (!sampling || capturing) return;
    const result = await probe(sources);
    if (result) history.push(result.sample);
    const settled = painted(sources) && (afterPaint += 1) > PERF_LIMITS.afterPaintSamples;
    if (history.length >= PERF_LIMITS.maxSamples || settled) {
      sampling = false;
      return;
    }
    timer = setTimeout(() => void tick(), PERF_LIMITS.sampleIntervalMs);
  };
  timer = setTimeout(() => void tick(), PERF_LIMITS.sampleIntervalMs);
  return () => {
    if (timer) clearTimeout(timer);
    sampling = false;
  };
}

function stopSampling(): void {
  sampling = false;
}

/** The boot window plus a burst taken now, with device and storage facts attached. */
export async function captureSnapshot(sources: CaptureSources): Promise<PerfSnapshot> {
  // Freeze and pause first: a sampler still ticking would append newer probes behind the
  // burst's older ones and the report would read out of order.
  const bootWindow = [...history];
  const wasSampling = sampling;
  capturing = true;
  const burst: PerfSample[] = [];
  let procs: GuestProc[] = [];
  try {
    for (let index = 0; index < PERF_LIMITS.burstProbes; index += 1) {
      // Sequential on purpose: five concurrent probes would queue behind each other in the FS
      // worker and report their own contention instead of the machine's.
      // oxlint-disable-next-line no-await-in-loop -- see above.
      const result = await probe(sources);
      if (!result) continue;
      burst.push(result.sample);
      procs = result.procs;
    }
  } finally {
    capturing = false;
    sampling = wasSampling;
  }
  const samples = [...bootWindow, ...burst].toSorted((a, b) => a.t - b.t);
  const marks = sources.bootMarks();
  const storage = await sources.storage();
  return {
    schema: 1,
    capturedAt: new Date().toISOString(),
    device: {
      ...sources.device(),
      storageUsedBytes: storage.usedBytes,
      storageQuotaBytes: storage.quotaBytes,
    },
    boot: { marks, bootMs: bootDurationMs(marks) },
    fs: summarizeLatency(samples),
    vfs: vfsTrend(samples),
    samples,
    procs,
    terminal: sources.terminal(),
  };
}

function readBootMarks(): BootMark[] {
  if (typeof window === "undefined") return [];
  // oxlint-disable-next-line no-underscore-dangle -- the kernel's own global, not our naming.
  const marks = (window as Window & { __vvBoot?: BootMark[] }).__vvBoot;
  return Array.isArray(marks) ? marks : [];
}

/** Whatever the browser exposes about this device; null where it says nothing. */
export function readDeviceFacts(): DeviceFacts {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const memory = (
    typeof performance === "undefined"
      ? undefined
      : (performance as Performance & {
          memory?: { usedJSHeapSize?: number; jsHeapSizeLimit?: number };
        })
  )?.memory;
  const deviceMemory = (nav as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory;
  return {
    userAgent: nav?.userAgent ?? "",
    platform: nav?.platform ?? "",
    cores: typeof nav?.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
    deviceMemoryGb: typeof deviceMemory === "number" ? deviceMemory : null,
    pageHeapBytes: typeof memory?.usedJSHeapSize === "number" ? memory.usedJSHeapSize : null,
    heapLimitBytes: typeof memory?.jsHeapSizeLimit === "number" ? memory.jsHeapSizeLimit : null,
    storageUsedBytes: null,
    storageQuotaBytes: null,
  };
}

async function readStorage(): Promise<{ usedBytes: number | null; quotaBytes: number | null }> {
  try {
    const estimate = await navigator.storage?.estimate();
    return { usedBytes: estimate?.usage ?? null, quotaBytes: estimate?.quota ?? null };
  } catch {
    return { usedBytes: null, quotaBytes: null };
  }
}

/** Zero-delay timer round-trip: how long the page's own event loop takes to come back. */
function measurePageLag(): Promise<number> {
  return new Promise((resolve) => {
    const started = performance.now();
    setTimeout(() => resolve(performance.now() - started), 0);
  });
}

/** The live sources the status bar wires: the kernel bridge, this tab's terminals, this device. */
export function ideSources(bridge: KernelBridge, terminal: () => string[]): CaptureSources {
  return {
    diag: () => bridge.diag(),
    stat: () => bridge.request("vv-stat", { path: "/" }, { timeout: PERF_LIMITS.probeTimeoutMs }),
    bootMarks: readBootMarks,
    terminal,
    device: readDeviceFacts,
    storage: readStorage,
    lag: measurePageLag,
    now: () => performance.now(),
  };
}
