// The device's own limits, as the browser exposes them, for the status bar and for triage.
//
// The VM runs entirely inside this tab: the kernel, the file-system worker, one worker per
// guest process and rolldown's wasm threads all share one memory budget. Measured on a
// desktop with this project: ~1.2 GB of JS heap across the VMs, of which the vite process
// worker is ~540 MB and Monaco's ts.worker ~420 MB. On a device with 8 GB of RAM that is the
// difference between "boots" and "swaps", and nothing in the UI said why: "it is slow on this
// PC" looked exactly like "the IDE has a bug". These are the signals the status bar can show.
//
// Deliberately NOT part of IdeSnapshot: it changes at most twice a session (on the first
// sample, again when the first preview paints), so folding it in would wake every useIde()
// consumer for nothing.
//
// What it cannot see, and does not pretend to:
//   - GPU memory: not exposed to JS at all.
//   - a worker killed for out-of-memory: Chrome fires no event (see vendor/vivari AGENTS.md).
//   - total tab memory: performance.memory covers the page only, so the guest workers are
//     asked for their heaps through __vv.diag() and added on top. Still an estimate.
//   - RAM above 8 GB: navigator.deviceMemory is clamped to 8, so it can only ever say
//     "small device"; it cannot distinguish a 16 GB laptop from a 64 GB desktop when
//     explaining a slow boot. The boot time itself is the honest signal there.

/** The thresholds, named so a test can pin them and a reviewer can argue with them. */
export const DEVICE_LIMITS = {
  /** navigator.deviceMemory is rounded to a power of two and clamped at 8. */
  lowDeviceMemoryGb: 4,
  /** A single tab holding this much JS heap (page + guest workers) is one to warn about. */
  tabHeapAdvisoryBytes: 1_500_000_000,
  /** The page's own heap against its cap: the closer to the cap, the sooner a GC storm. */
  pageHeapPressureRatio: 0.85,
  /** OPFS holds the VFS mirror and the dependency snapshots; near-full is a boot that stalls. */
  storagePressureRatio: 0.9,
  /** kernel-online to preview-paint: ~18 s warm on a healthy laptop, 80 s from a cold profile. */
  slowBootMs: 45_000,
  /** The diag round-trip is for a readout, never worth blocking the UI on. */
  diagTimeoutMs: 2_000,
} as const;

/** What is wrong, most severe first. Each code is one status-bar readout (status.device.*). */
export type DeviceIssue = "memory-pressure" | "low-memory" | "slow-boot" | "low-storage";

export interface DeviceSignals {
  /** GB, rounded down by the browser to a power of two; null where unsupported. */
  deviceMemoryGb: number | null;
  /** Logical cores the guest also reads for its worker pools. */
  cores: number | null;
  /** This page's JS heap (Chrome's performance.memory); workers are separate. */
  heapUsedBytes: number | null;
  heapLimitBytes: number | null;
  /** Heaps of the guest process workers, summed, from __vv.diag(); null without a kernel. */
  guestHeapBytes: number | null;
  storageUsedBytes: number | null;
  storageQuotaBytes: number | null;
  /** kernel-online to preview-paint from the boot marks; null before a project has painted. */
  bootMs: number | null;
}

export interface DeviceHealth {
  signals: DeviceSignals;
  issues: DeviceIssue[];
}

/** Page heap + guest worker heaps: the tab's total, as far as it is observable. */
export function tabHeapBytes(signals: DeviceSignals): number | null {
  if (signals.heapUsedBytes === null && signals.guestHeapBytes === null) return null;
  return (signals.heapUsedBytes ?? 0) + (signals.guestHeapBytes ?? 0);
}

/** The issues these signals warrant, most severe first. Pure: the thresholds are the whole rule. */
export function classifyDeviceHealth(signals: DeviceSignals): DeviceIssue[] {
  const issues: DeviceIssue[] = [];
  const tabHeap = tabHeapBytes(signals);
  const pageRatio =
    signals.heapUsedBytes !== null && signals.heapLimitBytes !== null && signals.heapLimitBytes > 0
      ? signals.heapUsedBytes / signals.heapLimitBytes
      : null;
  if (
    (tabHeap !== null && tabHeap >= DEVICE_LIMITS.tabHeapAdvisoryBytes) ||
    (pageRatio !== null && pageRatio >= DEVICE_LIMITS.pageHeapPressureRatio)
  ) {
    issues.push("memory-pressure");
  }
  if (signals.deviceMemoryGb !== null && signals.deviceMemoryGb <= DEVICE_LIMITS.lowDeviceMemoryGb) {
    issues.push("low-memory");
  }
  if (signals.bootMs !== null && signals.bootMs >= DEVICE_LIMITS.slowBootMs) {
    issues.push("slow-boot");
  }
  if (
    signals.storageUsedBytes !== null &&
    signals.storageQuotaBytes !== null &&
    signals.storageQuotaBytes > 0 &&
    signals.storageUsedBytes / signals.storageQuotaBytes >= DEVICE_LIMITS.storagePressureRatio
  ) {
    issues.push("low-storage");
  }
  return issues;
}

interface BootMark {
  name: string;
  t: number;
}

function readBootMarks(): BootMark[] {
  if (typeof window === "undefined") return [];
  const marks = (window as Window & { __vvBoot?: BootMark[] }).__vvBoot;
  return Array.isArray(marks) ? marks : [];
}

/** kernel-online to preview-paint, in ms; null until a project has painted once. */
export function bootDurationMs(marks: BootMark[] = readBootMarks()): number | null {
  const online = marks.find((mark) => mark.name === "kernel-online")?.t;
  const painted = marks.find((mark) => mark.name === "preview-paint")?.t;
  if (typeof online !== "number" || typeof painted !== "number") return null;
  const ms = painted - online;
  return ms > 0 ? ms : null;
}

/** Kernel diagnostics arity: only the per-process heap is needed here. */
interface DiagReply {
  procs?: { heapBytes?: number }[];
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]).catch(() => null);
}

/** Sum of the guest process workers' heaps, from the kernel's own accounting. */
export async function readGuestHeapBytes(): Promise<number | null> {
  if (typeof window === "undefined") return null;
  const diag = (window as Window & { __vv?: { diag?: () => Promise<DiagReply> } }).__vv?.diag;
  if (typeof diag !== "function") return null;
  const reply = await withTimeout(diag(), DEVICE_LIMITS.diagTimeoutMs);
  const procs = Array.isArray(reply?.procs) ? reply.procs : [];
  const sum = procs.reduce(
    (total, proc) => total + (typeof proc.heapBytes === "number" && proc.heapBytes > 0 ? proc.heapBytes : 0),
    0,
  );
  return sum > 0 ? sum : null;
}

/** Sample every signal the browser offers. Never throws: an unavailable one is null. */
export async function readDeviceSignals(): Promise<DeviceSignals> {
  const nav =
    typeof navigator === "undefined" ? undefined : (navigator as Navigator & { deviceMemory?: number });
  const perf =
    typeof performance === "undefined"
      ? undefined
      : (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } });
  let storageUsedBytes: number | null = null;
  let storageQuotaBytes: number | null = null;
  try {
    const estimate = await nav?.storage?.estimate?.();
    storageUsedBytes = typeof estimate?.usage === "number" ? estimate.usage : null;
    storageQuotaBytes = typeof estimate?.quota === "number" ? estimate.quota : null;
  } catch {
    /* Storage is blocked in some profiles; the memory signals are still worth reporting. */
  }
  const memory = perf?.memory;
  return {
    deviceMemoryGb: typeof nav?.deviceMemory === "number" ? nav.deviceMemory : null,
    cores: typeof nav?.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
    heapUsedBytes: memory ? memory.usedJSHeapSize : null,
    heapLimitBytes: memory ? memory.jsHeapSizeLimit : null,
    guestHeapBytes: await readGuestHeapBytes(),
    storageUsedBytes,
    storageQuotaBytes,
    bootMs: bootDurationMs(),
  };
}

const listeners = new Set<() => void>();
let snapshot: DeviceHealth | null = null;
let started = false;

/** useSyncExternalStore subscriber; module state keeps the readout out of IdeSnapshot. */
export function subscribeDeviceHealth(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDeviceHealth(): DeviceHealth | null {
  return snapshot;
}

/** Re-sample and publish. Safe to call at any time; concurrent calls settle last-wins. */
export async function refreshDeviceHealth(): Promise<DeviceHealth> {
  const signals = await readDeviceSignals();
  const next: DeviceHealth = { signals, issues: classifyDeviceHealth(signals) };
  snapshot = next;
  for (const listener of listeners) listener();
  return next;
}

/**
 * Sample once now and again when the first preview paints (the boot time is only known
 * then). Idempotent, so the status bar can call it from an effect on every mount.
 */
export function startDeviceHealth(): void {
  if (started) return;
  started = true;
  void refreshDeviceHealth();
  if (typeof PerformanceObserver === "undefined") return;
  try {
    const observer = new PerformanceObserver((list) => {
      if (!list.getEntries().some((entry) => entry.name === "vv:preview-paint")) return;
      observer.disconnect();
      void refreshDeviceHealth();
    });
    observer.observe({ type: "mark", buffered: true });
  } catch {
    /* Mark observation is an optimisation; the sample above already stands. */
  }
}
