// The "Measure Memory" breakdown: the tab's page estimate plus the VFS content
// footprint and per-Process-Worker heaps reported by the kernel. Split out of
// controller.ts, which only keeps the entry point that publishes the result.

import type { KernelBridge } from "./kernel";

// A snapshot of the tab's memory, produced by measureMemory(). `total` is the
// whole-page estimate (performance.measureUserAgentSpecificMemory, which covers
// dedicated workers); `vfsBytes`/`vfsFiles` are the VFS's in-RAM content size
// reported by the File System Worker. `measuring` gates the StatusBar spinner.
export interface MemInfo {
  total: number | null;
  vfsBytes: number;
  vfsFiles: number;
  // Uncompressed VFS footprint; equals vfsBytes when compression is off. When
  // compression is on, vfsBytes/vfsLogicalBytes is the realized ratio.
  vfsLogicalBytes: number;
  ts: number;
}

// Per-Process-Worker memory row for the "Measure Memory" breakdown. `heap` is the
// worker's own JS heap (performance.memory, Chrome-only; -1 if unavailable),
// `modules` the guest module-cache entry count, `esbuildInproc` whether it hosts
// the resident esbuild Go wasm service.
export interface ProcMem {
  pid: number;
  name: string;
  heap: number;
  modules: number;
  esbuildInproc: boolean;
  // Bytes of the in-process esbuild Go wasm heap (0 if not hosted in this PID).
  esbuildBytes: number;
}

// Render the esbuild-wasm annotation for a per-PID memory row: the resident Go
// heap size when known (grows-and-stays for the worker's life), else just a flag.
function esbuildLabel(p: ProcMem): string {
  if (!p.esbuildInproc) return "";
  const bytes = Number(p.esbuildBytes);
  return bytes > 0 ? `, esbuild-wasm ${fmtBytes(bytes)}` : ", esbuild-wasm";
}

// Human-readable byte size for the memory readout (MB/GB with one decimal).
export const fmtBytes = (n: number): string => {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
};

/** Measure this tab's memory and log a breakdown through `say` (the Console).
 *  Returns the snapshot the status bar reads; never throws. */
export async function probeMemory(
  bridge: KernelBridge,
  say: (text: string, color?: string) => void,
): Promise<MemInfo> {
  say("Measuring memory…", "90");
  let total: number | null = null;
  type MemResult = {
    bytes: number;
    breakdown?: { bytes: number; types?: string[]; attribution?: { url?: string }[] }[];
  };
  const perf = performance as Performance & {
    measureUserAgentSpecificMemory?: () => Promise<MemResult>;
  };
  try {
    if (typeof perf.measureUserAgentSpecificMemory === "function") {
      const r = await perf.measureUserAgentSpecificMemory();
      total = r.bytes;
      say(`Tab total (page + workers): ${fmtBytes(total)}`, "36");
      // Largest attributed buckets first, so the dominant consumer is obvious.
      const rows = (r.breakdown ?? [])
        .filter((b) => b.bytes > 0)
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 12);
      for (const b of rows) {
        const label =
          (b.attribution ?? [])
            .map((a) => a.url)
            .filter(Boolean)
            .join(", ") ||
          (b.types ?? []).join("/") ||
          "(unattributed)";
        say(`  ${fmtBytes(b.bytes).padStart(9)}  ${label}`, "90");
      }
    } else {
      say(
        "performance.measureUserAgentSpecificMemory() unavailable (needs a Chromium browser + cross-origin isolation).",
        "31",
      );
    }
  } catch (err) {
    say(`memory measurement failed: ${(err as Error)?.message ?? err}`, "31");
  }

  // VFS content footprint (the File System Worker's Wasm) + the kernel worker's
  // own measurement, gathered over the bridge.
  let vfsBytes = -1;
  let vfsFiles = -1;
  let vfsLogicalBytes = -1;
  try {
    const m = await bridge.request("vv-mem");
    vfsBytes = Number(m.vfsBytes ?? -1);
    vfsFiles = Number(m.vfsFiles ?? -1);
    vfsLogicalBytes = Number(m.vfsLogicalBytes ?? -1);
    if (vfsBytes >= 0) {
      say(`VFS content in RAM: ${fmtBytes(vfsBytes)} across ${vfsFiles} files`, "36");
      // Show the realized compression ratio when the logical size is larger
      // (i.e. some files are stored compressed).
      if (vfsLogicalBytes > vfsBytes) {
        const saved = vfsLogicalBytes - vfsBytes;
        const ratio = (vfsBytes / vfsLogicalBytes) * 100;
        say(
          `  compressed from ${fmtBytes(vfsLogicalBytes)} (${ratio.toFixed(0)}% of logical, saved ${fmtBytes(saved)})`,
          "90",
        );
      }
    } else {
      say("VFS content size unavailable (rebuild the VFS wasm: `npm run build:vfs`).", "90");
    }
    if (typeof m.kernelBytes === "number") {
      say(`Kernel worker: ${fmtBytes(m.kernelBytes as number)}`, "90");
    }
    // Per-PID Process Worker breakdown: turns the flat "N GB on process-worker.js"
    // figure into which process holds it (dev servers dominate), how many modules
    // its guest cache retains, and whether it hosts the resident esbuild wasm.
    const procs = Array.isArray(m.procs) ? (m.procs as ProcMem[]) : [];
    const withHeap = procs.filter((p) => Number(p.heap) >= 0);
    if (withHeap.length > 0) {
      say("Process workers (own JS heap):", "36");
      for (const p of withHeap) {
        const mods = Number(p.modules) >= 0 ? `${p.modules} modules` : "modules n/a";
        say(
          `  ${fmtBytes(Number(p.heap)).padStart(9)}  ${p.name} (${mods}${esbuildLabel(p)})`,
          "90",
        );
      }
    } else if (procs.length > 0) {
      // Heap sizing unavailable (performance.memory off) — still show retention.
      say("Process workers (heap size unavailable):", "36");
      for (const p of procs) {
        say(
          `  ${p.name}: ${Number(p.modules) >= 0 ? p.modules + " modules" : "modules n/a"}${esbuildLabel(p)}`,
          "90",
        );
      }
    }
  } catch {
    /* kernel not ready */
  }

  return { total, vfsBytes, vfsFiles, vfsLogicalBytes, ts: Date.now() };
}
