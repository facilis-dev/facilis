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
  diag: () => Promise<unknown>;
  bootMarks: () => BootMark[];
  terminal: () => string[];
  device: () => DeviceFacts;
  storage: () => Promise<{ usedBytes: number | null; quotaBytes: number | null }>;
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

async function probe(sources: CaptureSources): Promise<{ sample: PerfSample; procs: GuestProc[] }> {
  const started = sources.now();
  const result = await withTimeout(sources.diag(), PERF_LIMITS.probeTimeoutMs);
  const timedOut = result === TIMED_OUT;
  const facts = readDiag(timedOut ? null : result.reply);
  return {
    sample: {
      t: Math.round(started),
      rttMs: timedOut ? null : Math.round(sources.now() - started),
      files: facts.files,
      bytes: facts.bytes,
      deferred: facts.deferred,
      silentMaxMs: facts.silentMaxMs,
    },
    procs: facts.procs,
  };
}

// The boot window this tab has already lived through (see the header for why it is module state).
let history: PerfSample[] = [];
let sampling = false;

export function perfHistory(): readonly PerfSample[] {
  return history;
}

/** Test seam: the only reason the history is resettable. */
export function resetPerfHistory(): void {
  history = [];
  sampling = false;
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
    if (!sampling) return;
    const { sample } = await probe(sources);
    history.push(sample);
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
  const burst: PerfSample[] = [];
  let procs: GuestProc[] = [];
  for (let index = 0; index < PERF_LIMITS.burstProbes; index += 1) {
    const result = await probe(sources);
    burst.push(result.sample);
    procs = result.procs;
  }
  const samples = [...history, ...burst];
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

/** The live sources the status bar wires: the kernel bridge, this tab's terminals, this device. */
export function ideSources(
  bridge: { diag: () => Promise<unknown> },
  terminal: () => string[],
): CaptureSources {
  return {
    diag: () => bridge.diag(),
    bootMarks: readBootMarks,
    terminal,
    device: readDeviceFacts,
    storage: readStorage,
    now: () => performance.now(),
  };
}
