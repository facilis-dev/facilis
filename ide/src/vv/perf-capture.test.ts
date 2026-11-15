import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  captureSnapshot,
  type CaptureSources,
  perfHistory,
  resetPerfHistory,
  startPerfSampling,
} from "./perf-capture";
import { downloadSnapshot, renderSnapshot, snapshotFilename } from "./perf-report";
import {
  type BootMark,
  classifyLatency,
  PERF_LIMITS,
  percentile,
  readDiag,
  summarizeLatency,
  terminalTail,
  vfsTrend,
} from "./perf-samples";

const diagReply = (files: number, deferred: number, silent: number) => ({
  vfs: { files, bytes: files * 10, deferred },
  procs: [
    {
      pid: 5,
      command: "vite --configLoader native",
      sinceOutputMs: silent,
      syscalls: 12,
      booted: true,
    },
    {
      pid: 6,
      command: "wasi-worker.mjs",
      sinceOutputMs: silent - 1000,
      syscalls: 0,
      booted: false,
    },
  ],
});

/** Deterministic clock: every probe starts 1000 ms after the previous one and lasts 1000 ms. */
function fakeSources(
  marks: BootMark[] = [],
  reply: unknown = diagReply(100, 5, 2000),
): CaptureSources {
  let clock = 0;
  return {
    diag: () => Promise.resolve(reply),
    bootMarks: () => marks,
    terminal: () => ["[runtime] PID 5 has printed nothing for 64s"],
    device: () => ({
      userAgent: "test-agent",
      platform: "test",
      cores: 12,
      deviceMemoryGb: 8,
      pageHeapBytes: 1000,
      heapLimitBytes: 4000,
      storageUsedBytes: null,
      storageQuotaBytes: null,
    }),
    storage: () => Promise.resolve({ usedBytes: 2048, quotaBytes: 4096 }),
    now: () => (clock += 1000),
  };
}

beforeEach(() => {
  resetPerfHistory();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Just enough DOM for the download path; the file itself is the browser's. */
function stubDocument(): void {
  vi.stubGlobal("document", {
    createElement: () => ({ href: "", download: "", click: () => {}, remove: () => {} }),
    body: { appendChild: () => {} },
  });
}

describe("percentile", () => {
  it("returns null with nothing to rank", () => {
    expect(percentile([], 50)).toBeNull();
  });
  it("is nearest-rank, not interpolated", () => {
    expect(percentile([105], 50)).toBe(105);
    expect(percentile([100, 200, 2000], 50)).toBe(200);
    expect(percentile([100, 200, 2000], 95)).toBe(2000);
  });
});

describe("classifyLatency", () => {
  it("calls a healthy machine healthy", () => {
    expect(classifyLatency(PERF_LIMITS.healthyRttMs, 0)).toBe("healthy");
  });
  it("grades the 2 s warm-boot case as saturated", () => {
    expect(classifyLatency(2008, 0)).toBe("saturated");
  });
  it("a window of timeouts is saturated, not unknown", () => {
    expect(classifyLatency(null, 3)).toBe("saturated");
    expect(classifyLatency(null, 0)).toBe("unknown");
  });
});

describe("readDiag", () => {
  it("survives a reply that is not the protocol", () => {
    expect(readDiag(null)).toEqual({
      files: null,
      bytes: null,
      deferred: null,
      silentMaxMs: null,
      procs: [],
    });
    expect(readDiag({ vfs: "nope" }).files).toBeNull();
  });
  it("reads the counters and the longest silence", () => {
    const facts = readDiag(diagReply(19664, 587, 40000));
    expect(facts.files).toBe(19664);
    expect(facts.deferred).toBe(587);
    expect(facts.silentMaxMs).toBe(40000);
    expect(facts.procs.map((proc) => proc.command)).toContain("vite --configLoader native");
  });
});

describe("summarizeLatency", () => {
  it("counts timeouts as probes that answered nothing", () => {
    const summary = summarizeLatency([
      { t: 0, rttMs: 2000, files: 1, bytes: 1, deferred: 0, silentMaxMs: 0 },
      { t: 1, rttMs: null, files: 1, bytes: 1, deferred: 0, silentMaxMs: 0 },
    ]);
    expect(summary).toMatchObject({
      probes: 2,
      answered: 1,
      timeouts: 1,
      p50Ms: 2000,
      verdict: "saturated",
    });
  });
});

describe("vfsTrend", () => {
  it("says nothing moved when the counters are identical", () => {
    const sample = { t: 0, rttMs: 100, files: 10, bytes: 5, deferred: 2, silentMaxMs: 0 };
    expect(vfsTrend([sample, { ...sample, t: 1000 }]).changed).toBe(false);
  });
  it("sees a hydration moving the deferred count", () => {
    const a = { t: 0, rttMs: 100, files: 10, bytes: 5, deferred: 2, silentMaxMs: 0 };
    const b = { ...a, t: 1000, deferred: 0 };
    expect(vfsTrend([a, b])).toMatchObject({ deferredStart: 2, deferredEnd: 0, changed: true });
  });
});

describe("terminalTail", () => {
  it("keeps the last rows, oldest first", () => {
    const rows = ["a", "b", "c", "d"];
    const term = {
      buffer: {
        active: {
          length: rows.length,
          getLine: (index: number) => ({ translateToString: () => rows[index] ?? "" }),
        },
      },
    };
    expect(terminalTail(term, 2)).toEqual(["c", "d"]);
  });
});

describe("captureSnapshot", () => {
  it("writes the boot window, the burst, the device and the storage in one snapshot", async () => {
    const marks: BootMark[] = [
      { name: "kernel-online", t: 500 },
      { name: "preview-paint", t: 156_819 },
    ];
    const snapshot = await captureSnapshot(fakeSources(marks));
    expect(snapshot.schema).toBe(1);
    expect(snapshot.samples).toHaveLength(PERF_LIMITS.burstProbes);
    expect(snapshot.fs.p50Ms).toBe(1000);
    expect(snapshot.fs.verdict).toBe("degraded");
    expect(snapshot.boot.bootMs).toBe(156_319);
    expect(snapshot.device.storageQuotaBytes).toBe(4096);
    expect(snapshot.procs[0]?.command).toBe("vite --configLoader native");
    expect(snapshot.terminal).toHaveLength(1);
  });
});

describe("startPerfSampling", () => {
  it("samples until the boot has painted, then stops", async () => {
    vi.useFakeTimers();
    const marks: BootMark[] = [
      { name: "kernel-online", t: 1 },
      { name: "preview-paint", t: 2 },
    ];
    startPerfSampling(fakeSources(marks));
    await vi.advanceTimersByTimeAsync(
      PERF_LIMITS.sampleIntervalMs * (PERF_LIMITS.afterPaintSamples + 2),
    );
    const sampled = perfHistory().length;
    expect(sampled).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(PERF_LIMITS.sampleIntervalMs * 5);
    expect(perfHistory().length).toBe(sampled);
  });
});

describe("the report", () => {
  it("renders the numbers a maintainer reads first, and embeds the raw snapshot", async () => {
    const snapshot = await captureSnapshot(fakeSources());
    const document = renderSnapshot(snapshot);
    expect(document).toContain("### FS answer latency");
    expect(document).toContain("p50 1000 ms");
    expect(document).toContain("verdict: **degraded");
    expect(document).toContain("files 100 to 100");
    expect(document).toContain("PID 5 has printed nothing for 64s");
    const raw = document.split("```json")[1]?.split("```")[0] ?? "";
    expect(JSON.parse(raw)).toMatchObject({ schema: 1 });
  });
  it("names the file from the capture time, filesystem-safe", async () => {
    const snapshot = await captureSnapshot(fakeSources());
    expect(snapshotFilename(snapshot)).toMatch(/^facilis-perf-[0-9T-]+Z\.md$/);
  });
});

describe("downloadSnapshot", () => {
  it("saves one markdown file and returns its name", async () => {
    const snapshot = await captureSnapshot(fakeSources());
    stubDocument();
    const spy = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const name = downloadSnapshot(snapshot);
    expect(spy).toHaveBeenCalledWith(expect.any(Blob));
    expect(name).toBe(snapshotFilename(snapshot));
  });
});
