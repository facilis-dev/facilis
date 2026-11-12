// Reusable machinery for scripts/dev/profile-ide.mjs: Chrome CPU-profile math, the
// diag/output sampler, the recursive worker-target profiler, the stall detector, and the
// summary tables. Split out so the entry script stays a readable orchestration file.
//
// Nothing in the math is Chrome-specific beyond the profile shape: self time is summed
// from {samples, timeDeltas} (hitCount is visits, not duration), and wasm frames are
// called out because "JS 2% / wasm 90%" is a different diagnosis from "JS 90%".

const WASM_FUNCTION = /^wasm-function/;
const WASM_URL = /\.wasm(?:\?|#|$)/;

/** The milestones of a Facilis boot, in order; see ide/src/vv/boot-marks.ts. */
export const MILESTONES = [
  "js-executed",
  "kernel-online",
  "kernel-ready",
  "install-start",
  "preview-open",
  "preview-paint",
];

function frameOf(callFrame) {
  const name = callFrame?.functionName || "(anonymous)";
  const url = callFrame?.url || "";
  const line = (callFrame?.lineNumber ?? -1) + 1;
  return { name, url, line, wasm: WASM_FUNCTION.test(name) || WASM_URL.test(url) };
}

const keyOf = (frame) => frame.name + "\u0000" + frame.url + "\u0000" + frame.line;

/** Self time per function, in ms, from one .cpuprofile object. */
export function profileSelfTime(profile) {
  const nodes = new Map((profile.nodes || []).map((node) => [node.id, node]));
  const functions = new Map();
  let totalUs = 0;
  let idleUs = 0;
  let wasmUs = 0;
  const samples = profile.samples || [];
  const deltas = profile.timeDeltas || [];
  for (let i = 0; i < samples.length; i++) {
    const deltaUs = deltas[i] || 0;
    totalUs += deltaUs;
    const node = nodes.get(samples[i]);
    if (!node) continue;
    const frame = frameOf(node.callFrame || {});
    if (frame.name === "(idle)") idleUs += deltaUs;
    if (frame.wasm) wasmUs += deltaUs;
    const key = keyOf(frame);
    let entry = functions.get(key);
    if (!entry) {
      entry = { ...frame, selfUs: 0 };
      functions.set(key, entry);
    }
    entry.selfUs += deltaUs;
  }
  return { totalMs: totalUs / 1000, idleMs: idleUs / 1000, wasmMs: wasmUs / 1000, functions };
}

/** Top-N functions by self time, descending. */
export function topFunctions(stats, limit) {
  return [...stats.functions.values()]
    .sort((a, b) => b.selfUs - a.selfUs)
    .slice(0, limit)
    .map((f) => ({ ...f, selfMs: f.selfUs / 1000 }));
}

/** Merge per-target stats: entries = [{ label, stats }]. */
export function mergeSelfTimes(entries) {
  const functions = new Map();
  let totalMs = 0;
  let idleMs = 0;
  let wasmMs = 0;
  for (const { label, stats } of entries) {
    totalMs += stats.totalMs;
    idleMs += stats.idleMs;
    wasmMs += stats.wasmMs;
    for (const fn of stats.functions.values()) {
      const key = keyOf(fn);
      let merged = functions.get(key);
      if (!merged) {
        merged = { name: fn.name, url: fn.url, line: fn.line, wasm: fn.wasm, selfUs: 0, labels: new Set() };
        functions.set(key, merged);
      }
      merged.selfUs += fn.selfUs;
      merged.labels.add(label);
    }
  }
  return { totalMs, idleMs, wasmMs, functions };
}

/** Boot marks -> one row per milestone with the delta from the previous one. */
export function bootTimeline(boot, timeOrigin, pageOpenWall) {
  const marks = (Array.isArray(boot) ? [...boot] : []).sort((a, b) => a.t - b.t);
  const origin = typeof timeOrigin === "number" ? timeOrigin : 0;
  let previousT = 0;
  const rows = marks.map((mark) => {
    const row = {
      name: mark.name,
      t: mark.t,
      deltaMs: mark.t - previousT,
      wall: origin + mark.t,
      wallFromOpenMs: origin + mark.t - pageOpenWall,
    };
    previousT = mark.t;
    return row;
  });
  const missing = MILESTONES.filter((name) => !marks.some((m) => m.name === name));
  return { rows, missing };
}

/**
 * One row per phase (page open -> mark 1 -> mark 2 ...): the diag aggregates for the
 * samples whose wall clock falls inside it. This is what localises the delay: the
 * milestones say WHICH window is slow, these numbers say whether the VM was working.
 */
export function phaseStats(timelineRows, samples, pageOpenWall) {
  const rows = [];
  let fromWall = pageOpenWall;
  for (const milestone of timelineRows) {
    const inWindow = samples.filter((s) => s.wall >= fromWall && s.wall <= milestone.wall);
    const first = inWindow[0];
    const last = inWindow[inWindow.length - 1];
    const syscalls = (sample) => sample?.diag?.syscalls ?? null;
    const files = (sample) => sample?.diag?.vfs?.files ?? null;
    const spanMs = last && first ? Math.max(1, last.wall - first.wall) : 0;
    const syscallsDelta = syscalls(last) != null && syscalls(first) != null ? syscalls(last) - syscalls(first) : null;
    let fetchInflightMax = 0;
    let fetchQueuedMax = 0;
    let pendingHttpMax = 0;
    let maxSilenceMs = 0;
    let maxSilenceProc = "";
    let rttSum = 0;
    for (const sample of inWindow) {
      const diag = sample.diag || {};
      if (diag.error) continue;
      const fetch = diag.fetch || {};
      fetchInflightMax = Math.max(fetchInflightMax, fetch.inflight || 0);
      fetchQueuedMax = Math.max(fetchQueuedMax, fetch.queued || 0);
      pendingHttpMax = Math.max(pendingHttpMax, diag.pendingHttp || 0);
      rttSum += sample.rttMs || 0;
      for (const proc of diag.procs || []) {
        if ((proc.sinceOutputMs || 0) > maxSilenceMs) {
          maxSilenceMs = proc.sinceOutputMs;
          maxSilenceProc = "PID " + proc.pid + " " + String(proc.command || "").slice(0, 22);
        }
      }
    }
    rows.push({
      phase: milestone.name,
      durMs: milestone.wall - fromWall,
      samples: inWindow.length,
      syscallsPerSec: syscallsDelta != null && spanMs > 0 ? (syscallsDelta * 1000) / spanMs : null,
      vfsFilesDelta: files(last) != null && files(first) != null ? files(last) - files(first) : null,
      fetchInflightMax,
      fetchQueuedMax,
      pendingHttpMax,
      maxSilenceMs,
      maxSilenceProc,
      rttAvgMs: inWindow.length ? rttSum / inWindow.length : 0,
    });
    fromWall = milestone.wall;
  }
  return rows;
}

const pad = (value, width, right = false) =>
  right ? String(value).padStart(width) : String(value).padEnd(width);
const secs = (ms) => (ms / 1000).toFixed(1) + "s";
const share = (part, whole) => (whole > 0 ? ((part / whole) * 100).toFixed(1) : "0.0") + "%";

function shortUrl(url) {
  if (!url) return "";
  try {
    const pathname = new URL(url).pathname;
    return pathname.split("/").filter(Boolean).slice(-2).join("/").slice(0, 46);
  } catch {
    return String(url).slice(-46);
  }
}

function functionRow(fn, busyMs, label) {
  const where = fn.wasm ? "[wasm] " + shortUrl(fn.url) : shortUrl(fn.url) + (fn.line > 0 ? ":" + fn.line : "");
  return (
    "  " +
    pad(share(fn.selfMs, busyMs), 6, true) +
    "  " +
    pad(fn.selfMs.toFixed(1), 9, true) +
    "ms  " +
    pad(String(fn.name).slice(0, 40), 40) +
    " " +
    (label ? "[" + label + "] " : "") +
    where
  );
}

export function formatTimeline(timeline) {
  const lines = [
    "BOOT TIMELINE (t = performance.now at the mark; delta = since previous mark)",
    "  " + pad("milestone", 18) + pad("t ms", 10, true) + pad("delta ms", 11, true) + pad("since open ms", 15, true),
  ];
  for (const row of timeline.rows) {
    lines.push(
      "  " +
        pad(row.name, 18) +
        pad(row.t.toFixed(1), 10, true) +
        pad(row.deltaMs.toFixed(1), 11, true) +
        pad(row.wallFromOpenMs.toFixed(0), 15, true),
    );
  }
  if (timeline.rows.length === 0) lines.push("  (no boot marks — did the page boot at all?)");
  if (timeline.missing.length) lines.push("  MISSING: " + timeline.missing.join(", "));
  return lines;
}

export function formatPhases(rows) {
  const lines = [
    "PHASES (diag samples inside each window; syscalls/s and VFS growth say whether the VM worked)",
    "  " +
      pad("phase ending at", 18) +
      pad("dur s", 8, true) +
      pad("n", 5, true) +
      pad("syscalls/s", 11, true) +
      pad("vfs Δfiles", 11, true) +
      pad("fetch i/q max", 14, true) +
      pad("pend max", 9, true) +
      pad("silent max", 11, true) +
      "  longest silence",
  ];
  for (const row of rows) {
    lines.push(
      "  " +
        pad(row.phase, 18) +
        pad(secs(row.durMs), 8, true) +
        pad(row.samples, 5, true) +
        pad(row.syscallsPerSec == null ? "—" : row.syscallsPerSec.toFixed(0), 11, true) +
        pad(row.vfsFilesDelta == null ? "—" : row.vfsFilesDelta, 11, true) +
        pad((row.fetchInflightMax || 0) + "/" + (row.fetchQueuedMax || 0), 14, true) +
        pad(row.pendingHttpMax || 0, 9, true) +
        pad(row.maxSilenceMs ? secs(row.maxSilenceMs) : "—", 11, true) +
        "  " +
        (row.maxSilenceProc || ""),
    );
  }
  return lines;
}

export function formatTop(entries, options = {}) {
  const { perTargetLimit = 5, mergedLimit = 12, minBusyMs = 500 } = options;
  const lines = ["TOP SELF TIME (share of that target's busy time; idle is excluded from the denominator)"];
  const active = entries.filter((entry) => entry.stats.totalMs > 0).sort((a, b) => b.stats.totalMs - a.stats.totalMs);
  for (const entry of active) {
    const busyMs = Math.max(1, entry.stats.totalMs - entry.stats.idleMs);
    if (busyMs < minBusyMs) continue;
    lines.push(
      entry.label +
        "  wall " +
        secs(entry.stats.totalMs) +
        "  busy " +
        secs(busyMs) +
        "  idle " +
        secs(entry.stats.idleMs) +
        "  wasm " +
        share(entry.stats.wasmMs, busyMs),
    );
    for (const fn of topFunctions(entry.stats, perTargetLimit)) lines.push(functionRow(fn, busyMs));
  }
  const merged = mergeSelfTimes(active);
  const busyMs = Math.max(1, merged.totalMs - merged.idleMs);
  lines.push(
    "MERGED TOP " +
      mergedLimit +
      " (all targets; wall " +
      secs(merged.totalMs) +
      ", idle " +
      secs(merged.idleMs) +
      ", wasm " +
      share(merged.wasmMs, busyMs) +
      ")",
  );
  const mergedTop = [...merged.functions.values()].sort((a, b) => b.selfUs - a.selfUs).slice(0, mergedLimit);
  for (const fn of mergedTop) {
    lines.push(functionRow({ ...fn, selfMs: fn.selfUs / 1000 }, busyMs, [...fn.labels].join(",").slice(0, 22)));
  }
  return lines;
}
/**
 * The diag() reply, reduced to the fields a time series needs (the raw reply carries
 * per-proc heap/module detail and can be large at 10 samples/s). Kept here so the
 * sampler in profile-ide.mjs stays a thin loop.
 */
export function compactDiag(raw, error) {
  if (!raw || typeof raw !== "object") return { error: error || "no diag" };
  const procs = Array.isArray(raw.procs)
    ? raw.procs.map((proc) => ({
        pid: proc.pid,
        ppid: proc.ppid,
        command: String(proc.command || "").slice(0, 140),
        sinceOutputMs: proc.sinceOutputMs ?? null,
        sinceSyscallMs: proc.sinceSyscallMs ?? null,
        syscalls: proc.syscalls ?? 0,
        workerErrors: proc.workerErrors ?? 0,
        booted: Boolean(proc.booted),
        paused: Boolean(proc.paused),
        heapBytes: proc.heapBytes ?? null,
      }))
    : [];
  const fetch = raw.fetch || {};
  return {
    error: raw.error ? String(raw.error) : null,
    procs,
    syscalls: procs.reduce((sum, proc) => sum + proc.syscalls, 0),
    fetch: {
      inflight: fetch.inflight ?? 0,
      queued: fetch.queued ?? 0,
      active: fetch.active ?? 0,
      cachedEntries: fetch.cachedEntries ?? 0,
    },
    pendingHttp: raw.pendingHttp ?? 0,
    listeners: Array.isArray(raw.listeners) ? raw.listeners : [],
    vfs: raw.vfs
      ? { files: raw.vfs.files, bytes: raw.vfs.bytes, logical: raw.vfs.logical, deferred: raw.vfs.deferred }
      : null,
  };
}

/**
 * Samples that are NOT the V8 idle node: the progress signal for a worker. A worker
 * wedged in Atomics.wait profiles as pure idle, which is exactly how a deadlock
 * differs from "busy install" even when no output arrives.
 */
export function nonIdleSamples(profile) {
  const nodes = new Map((profile.nodes || []).map((node) => [node.id, node]));
  let count = 0;
  for (const id of profile.samples || []) {
    const node = nodes.get(id);
    if (node && (node.callFrame?.functionName || "") !== "(idle)") count++;
  }
  return count;
}

import fs from "node:fs";
import path from "node:path";

/** Race a promise against a deadline; CDP calls to a wedged worker never settle. */
export function withTimeout(promise, timeoutMs, label) {
  let timer;
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label + " timed out after " + timeoutMs + "ms")), timeoutMs);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

// Page expressions, one concern each: the sampler and the run flow make one CDP
// round-trip per sample.
export const EXPR_INSTALL_OUTPUT =
  "(() => { const w = window; if (!w.__prof) w.__prof = { count: 0, byType: {}, lines: [], hooked: false };" +
  " const b = w.__vv && w.__vv.bridge; if (b && !w.__prof.hooked) { w.__prof.hooked = true;" +
  " b.onAny((m) => { const p = w.__prof; p.count++; const t = (m && m.type) || '?';" +
  " p.byType[t] = (p.byType[t] || 0) + 1;" +
  " if (t === 'term-out' || t === 'proc-out' || t === 'log' || t === 'demo-status') {" +
  " const text = String((m && (m.chunk !== undefined ? m.chunk : m.line)) || '');" +
  " if (text) { p.lines.push({ t: t, text: text.length > 4000 ? text.slice(-4000) : text });" +
  " if (p.lines.length > 2000) p.lines.splice(0, p.lines.length - 2000); } } }); }" +
  " return Boolean(b && w.__prof.hooked); })()";
export const EXPR_SAMPLE =
  "(async () => { const p = window.__prof;" +
  " const out = { prof: p ? { count: p.count, byType: p.byType, lines: p.lines.splice(0, 200) } : null };" +
  " try { out.diag = window.__vv && typeof window.__vv.diag === 'function' ? await window.__vv.diag() : null; }" +
  " catch (e) { out.diagError = String((e && e.message) || e); } return out; })()";
export const EXPR_KERNEL_READY =
  "Boolean(window.__ide && window.__ide.getSnapshot && window.__ide.getSnapshot().kernelReady)";
export const EXPR_MARKS = "(window.__vvBoot || []).map((m) => m.name)";
export const EXPR_TIMELINE =
  "({ boot: window.__vvBoot || [], timeOrigin: performance.timeOrigin," +
  " marks: performance.getEntriesByType('mark').filter((e) => e.name.indexOf('vv:') === 0)" +
  " .map((e) => ({ name: e.name.slice(3), t: e.startTime }))," +
  " nav: (() => { const n = performance.getEntriesByType('navigation')[0];" +
  " return n ? { domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd } : null; })() })";
export const EXPR_IDENTITY =
  "(() => { const r = {}; try { r.selfName = String(self.name || ''); } catch {}" +
  " try { const pid = /(\\d+)/.exec(r.selfName || ''); r.selfPid = pid ? Number(pid[1]) : null; } catch {}" +
  " try { r.hasProcess = typeof process !== 'undefined'; } catch {}" +
  " try { r.pid = r.hasProcess ? process.pid : r.selfPid; } catch {}" +
  " try { r.argv = r.hasProcess && process.argv ? process.argv.join(' ').slice(0, 300) : ''; } catch {}" +
  " try { r.hints = Object.keys(self).filter((k) => /(kernel|rolldown|vite|worker|process)/i.test(k)).slice(0, 8); } catch {}" +
  " return JSON.stringify(r); })()";
const PROCESS_WORKER = "process-worker";

/**
 * Profiles the page target plus every auto-attached worker, recursively.
 *
 * Recursion is the whole point: the kernel worker spawns one process worker per in-VM
 * process with "new Worker(...)" from inside a worker, and those are the targets where
 * npm, vite and rolldown actually burn CPU. Auto-attaching only the page shows none.
 * Segments are rotated on a timer so a worker that exits mid-run keeps the CPU it used,
 * and so a stall can snapshot fresh evidence while it is still frozen.
 */
export function createCpuTracker(client, { outDir, samplingUs = 1000, pidCommands = null }) {
  const targets = new Map();
  const byTargetId = new Map();
  const attached = [];
  const segments = [];
  let slot = 0;
  let activity = 0;
  let chain = Promise.resolve([]);
  let pendingRotations = 0;
  const call = (target, method, params, timeoutMs = 8000) =>
    withTimeout(client.send(method, params, target.sessionId), timeoutMs, method);

  // The worker's own name/argv is the only way to tell "the in-VM vite process" from the
  // fs worker: chrome's target URL says process-worker for every one of them. The kernel
  // names process workers "Process Worker PID <pid>" and threads "PID <pid>", so the pid
  // is parseable even where the guest's process global is not reachable from worker scope;
  // the command then comes from diag()'s proc list, matched by that pid.
  function labelOf(target) {
    const identity = target.identity || {};
    const base =
      (target.url || "").split("/").pop().split("?")[0].replace(/\.[a-z]+$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "-") ||
      target.kind;
    if (target.kind === "service_worker") return "service-worker";
    const pid = identity.pid != null ? identity.pid : (/(\d+)/.exec(String(identity.selfName || "")) || [])[1];
    if (base.indexOf(PROCESS_WORKER) === 0 && pid != null) {
      const command = pidCommands && pidCommands.get(Number(pid));
      const source = command || String(identity.argv || "");
      const program = source
        .split(/\s+/)
        .map((token) => token.split("/").pop())
        .find((token) => /vite|npm|node|rolldown|nitro|esbuild|sh|tsc|wasi/i.test(token));
      return "proc-" + pid + "-" + String(program || "node").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 24);
    }
    return base + (/process-worker/.test(base) ? "-" + (target.slot || slot) : "");
  }

  async function startProfiler(target) {
    try {
      await call(target, "Profiler.enable", {});
      await call(target, "Profiler.setSamplingInterval", { interval: samplingUs });
      await call(target, "Profiler.start", {});
      target.profiling = true;
      target.profileError = null;
      target.segmentStart = Date.now();
    } catch (error) {
      target.profiling = false;
      target.profileError = String((error && error.message) || error).slice(0, 200);
    }
  }

  async function stopProfiler(target) {
    if (!target.profiling) return null;
    target.profiling = false;
    try {
      const result = await call(target, "Profiler.stop", {}, 15000);
      return result.profile || null;
    } catch (error) {
      target.profileError = String((error && error.message) || error).slice(0, 200);
      return null;
    }
  }

  function keepSegment(target, profile, why) {
    if (!profile) return null;
    const segment = {
      label: target.label,
      kind: target.kind,
      url: target.url,
      why,
      startedAt: target.segmentStart,
      endedAt: Date.now(),
      profile,
    };
    segments.push(segment);
    activity += nonIdleSamples(profile);
    return segment;
  }

  async function rotateNow(why, restart) {
    const live = [...targets.values()].filter((target) => !target.detached && (target.profiling || target.profileError));
    const made = [];
    await Promise.all(
      live.map(async (target) => {
        const profile = await stopProfiler(target);
        const segment = keepSegment(target, profile, why);
        if (segment) made.push(segment);
        if (restart && !target.detached) await startProfiler(target);
      }),
    );
    return made;
  }

  // A periodic tick is skipped while one rotation is still waiting on a wedged worker: a
  // backlog would otherwise land all at once after the freeze ends.
  function rotate(why, restart = true, force = false) {
    if (!force && pendingRotations > 0) return Promise.resolve([]);
    pendingRotations++;
    const run = chain.then(() => rotateNow(why, restart)).finally(() => pendingRotations--);
    chain = run.catch(() => []);
    return run;
  }

  async function refineIdentity(target) {
    try {
      const result = await call(target, "Runtime.evaluate", { expression: EXPR_IDENTITY, returnByValue: true }, 3000);
      target.identity = JSON.parse(result.result.value || "{}");
    } catch {
      /* a worker busy booting has no time to identify itself; the URL still names it */
    }
    target.label = labelOf(target);
  }

  async function onAttach(sessionId, targetInfo) {
    if (targetInfo.type === "page" || byTargetId.has(targetInfo.targetId)) return;
    // Recurse: nested dedicated workers are related targets of the worker that spawned them.
    client
      .send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId)
      .catch(() => {});
    const target = {
      sessionId,
      targetId: targetInfo.targetId,
      kind: targetInfo.type,
      url: targetInfo.url || "",
      title: targetInfo.title || "",
      label: "",
      identity: null,
      profiling: false,
      detached: false,
      profileError: null,
      segmentStart: Date.now(),
    };
    slot++;
    target.label = labelOf(target);
    targets.set(sessionId, target);
    byTargetId.set(targetInfo.targetId, target);
    attached.push(target);
    await startProfiler(target);
    void refineIdentity(target);
  }

  client.on((message) => {
    if (message.method === "Target.attachedToTarget") {
      void onAttach(message.params.sessionId, message.params.targetInfo);
    } else if (message.method === "Target.detachedFromTarget") {
      const target = targets.get(message.params.sessionId);
      if (target) {
        target.detached = true;
        target.profiling = false;
      }
    }
  });

  async function trackPage(sessionId, url) {
    const target = {
      sessionId,
      targetId: "",
      kind: "page",
      url,
      title: "page",
      label: "page",
      identity: null,
      profiling: false,
      detached: false,
      profileError: null,
      segmentStart: Date.now(),
    };
    targets.set(sessionId, target);
    attached.push(target);
    await startProfiler(target);
  }

  /** Stop everything, write every segment as a .cpuprofile, and merge stats per target. */
  async function finalize() {
    await rotate("final", false, true);
    const totals = new Map();
    for (const segment of segments) totals.set(segment.label, (totals.get(segment.label) || 0) + 1);
    const seen = new Map();
    for (const segment of segments) {
      const index = (seen.get(segment.label) || 0) + 1;
      seen.set(segment.label, index);
      const suffix = totals.get(segment.label) === 1 ? "" : "-seg" + String(index).padStart(2, "0");
      segment.file = "cpu-" + segment.label + suffix + ".cpuprofile";
      fs.writeFileSync(path.join(outDir, segment.file), JSON.stringify(segment.profile));
    }
    const groups = new Map();
    for (const segment of segments) {
      const group = groups.get(segment.label) || { label: segment.label, kind: segment.kind, url: segment.url, stats: [] };
      group.stats.push({ label: segment.label, stats: profileSelfTime(segment.profile) });
      groups.set(segment.label, group);
    }
    return {
      attached: attached.map((target) => ({
        label: target.label,
        kind: target.kind,
        url: target.url,
        selfName: target.identity ? target.identity.selfName : null,
        pid: target.identity ? target.identity.pid : null,
        argv: target.identity ? target.identity.argv : null,
        profileError: target.profileError,
        detached: target.detached,
      })),
      segments: segments.map((segment) => ({
        label: segment.label,
        why: segment.why,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
        file: segment.file,
      })),
      entries: [...groups.values()].map((group) => ({
        label: group.label,
        kind: group.kind,
        url: group.url,
        stats: mergeSelfTimes(group.stats),
      })),
      activity,
    };
  }

  return { trackPage, rotate, finalize, activity: () => activity, targets: () => [...targets.values()] };
}

/** 100ms sampler: one page round-trip that drains the output stream and asks diag(). */
export function startSampler(page, { outDir, sampleMs, onSample }) {
  const origin = Date.now();
  const samples = [];
  const output = [];
  let stopped = false;
  let timer = null;
  let lastSample = null;
  const totalOutput = (byType) =>
    (byType["term-out"] || 0) + (byType["proc-out"] || 0) + (byType.log || 0) + (byType["demo-status"] || 0);
  const tick = async () => {
    const startedAt = Date.now();
    let payload = null;
    let error = null;
    try {
      payload = await withTimeout(page.evaluate(EXPR_SAMPLE), 6000, "sample");
    } catch (caught) {
      error = String((caught && caught.message) || caught);
    }
    const wall = Date.now();
    const prof = payload ? payload.prof : null;
    if (prof && prof.lines) output.push(...prof.lines);
    if (output.length > 4000) output.splice(0, output.length - 4000);
    const sample = {
      t: wall - origin,
      wall,
      rttMs: wall - startedAt,
      outputCount: prof ? totalOutput(prof.byType || {}) : 0,
      diag: compactDiag(payload ? payload.diag : null, error || (payload ? payload.diagError : null)),
    };
    samples.push(sample);
    fs.appendFileSync(path.join(outDir, "diag.jsonl"), JSON.stringify(sample) + "\n");
    lastSample = sample;
    if (onSample) onSample(sample);
    if (!stopped) timer = setTimeout(tick, Math.max(0, sampleMs - sample.rttMs));
  };
  void tick();
  return {
    samples: () => samples,
    output: () => output,
    lastSample: () => lastSample,
    stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/**
 * Debugger.pause is the probe that turns a deadlock into evidence: a CPU profile of a
 * futex wait is all idle, a stack says which frame it is parked on. Bounded at 5s per
 * worker and always resumed, because the VM is frozen but not ours to keep.
 */
export async function probeStacks(client, paused, targets) {
  const results = [];
  const workers = targets.filter((target) => !target.detached && target.kind === "worker" && !target.profileError);
  await Promise.all(
    workers.map(async (target) => {
      const record = {
        label: target.label,
        kind: target.kind,
        pid: target.identity ? target.identity.pid : null,
        frames: [],
        error: null,
      };
      paused.delete(target.sessionId);
      try {
        await withTimeout(client.send("Debugger.enable", {}, target.sessionId), 5000, "Debugger.enable");
        await withTimeout(client.send("Debugger.pause", {}, target.sessionId), 5000, "Debugger.pause");
        const until = Date.now() + 5000;
        let hit = null;
        while (Date.now() < until && !hit) {
          hit = paused.get(target.sessionId) || null;
          if (!hit) await new Promise((resolve) => setTimeout(resolve, 50));
        }
        if (!hit) {
          record.error = "no Debugger.paused within 5000ms";
        } else {
          record.frames = (hit.callFrames || []).map((frame, index) => ({
            index,
            function: frame.functionName || "(anonymous)",
            url: String(frame.url || "").slice(0, 200),
            line: frame.location ? frame.location.lineNumber : -1,
            wasm: /wasm-function/.test(frame.functionName || "") || /\.wasm/.test(frame.url || ""),
          }));
        }
      } catch (caught) {
        record.error = String((caught && caught.message) || caught).slice(0, 200);
      } finally {
        try {
          await withTimeout(client.send("Debugger.resume", {}, target.sessionId), 2000, "Debugger.resume");
        } catch {
          /* already resumed / unresponsive */
        }
        try {
          await withTimeout(client.send("Debugger.disable", {}, target.sessionId), 2000, "Debugger.disable");
        } catch {
          /* best effort */
        }
      }
      results.push(record);
    }),
  );
  return results;
}

/**
 * The stall detector, built ONLY on signals that survive the "fs traffic never reaches the
 * kernel" fact: the bridge output stream, per-proc output clocks, the VFS tree growing,
 * and non-idle CPU samples. diag().syscalls / sinceSyscallMs are deliberately not used —
 * an ordinary install barely moves them, so a flat counter must not read as "stuck".
 */
export function createProgressWatcher({ stallMs, maxStalls }) {
  const lastSilence = new Map();
  let output = -1;
  let files = null;
  let bytes = null;
  let logical = null;
  let procCount = -1;
  let activity = -1;
  let lastProgressAt = 0;
  let stalls = 0;
  return {
    observe(sample, cpuActivity, now = Date.now()) {
      if (!sample) return null;
      const diag = sample.diag || {};
      const procs = Array.isArray(diag.procs) ? diag.procs : [];
      const seen = new Set();
      let progress = false;
      if (output >= 0 && (sample.outputCount || 0) > output) progress = true;
      if (procCount >= 0 && procs.length !== procCount) progress = true;
      for (const proc of procs) {
        seen.add(proc.pid);
        const prior = lastSilence.get(proc.pid);
        if (prior !== undefined && proc.sinceOutputMs != null && proc.sinceOutputMs + 50 < prior) progress = true;
        lastSilence.set(proc.pid, proc.sinceOutputMs);
      }
      for (const pid of lastSilence.keys()) {
        if (!seen.has(pid)) {
          lastSilence.delete(pid);
          progress = true;
        }
      }
      const vfs = diag.vfs;
      if (vfs) {
        if (
          files !== null &&
          (vfs.files > files || vfs.bytes > bytes || (vfs.logical != null && logical != null && vfs.logical > logical))
        ) {
          progress = true;
        }
        files = vfs.files;
        bytes = vfs.bytes;
        logical = vfs.logical != null ? vfs.logical : logical;
      }
      if (activity >= 0 && cpuActivity > activity) progress = true;
      output = sample.outputCount != null ? sample.outputCount : output;
      procCount = procs.length;
      activity = cpuActivity;
      if (progress || lastProgressAt === 0) lastProgressAt = now;
      const sinceProgressMs = now - lastProgressAt;
      if (stalls >= maxStalls || sinceProgressMs < stallMs) return null;
      stalls++;
      // Reset the window: a long freeze yields one snapshot per stallMs, not one ever.
      lastProgressAt = now;
      return { n: stalls, sinceProgressMs, sample };
    },
    stalls: () => stalls,
  };
}

/** Rate/growth/proc highlights for the summary: numbers that explain the milestone table. */
export function formatDiagHighlights({ samples, output, stalled = [] }) {
  const lines = ["DIAG HIGHLIGHTS"];
  const valid = samples.filter((sample) => sample.diag && !sample.diag.error);
  if (valid.length === 0) {
    lines.push("  (no usable diag samples — was the bridge ever installed?)");
    return lines;
  }
  const rates = [];
  for (let index = 1; index < valid.length; index++) {
    const previous = valid[index - 1];
    const current = valid[index];
    const seconds = (current.wall - previous.wall) / 1000;
    if (seconds <= 0 || current.diag.syscalls < previous.diag.syscalls) continue;
    rates.push((current.diag.syscalls - previous.diag.syscalls) / seconds);
  }
  const sorted = [...rates].sort((a, b) => a - b);
  const percentile = (fraction) => (sorted.length ? sorted[Math.floor(fraction * (sorted.length - 1))] : 0);
  lines.push(
    "  samples " + samples.length + " (" + valid.length + " with diag)   diag rtt avg " +
      (valid.reduce((sum, sample) => sum + (sample.rttMs || 0), 0) / valid.length).toFixed(0) + "ms" +
      "   kernel syscalls/s p50 " + percentile(0.5).toFixed(0) + " max " + percentile(1).toFixed(0),
  );
  const first = valid[0].diag;
  const last = valid[valid.length - 1].diag;
  const fetchMax = { inflight: 0, queued: 0, active: 0 };
  const pendingMax = Math.max(...valid.map((sample) => sample.diag.pendingHttp || 0));
  let silencePeak = { sinceOutputMs: 0, pid: null, command: "", t: 0 };
  for (const sample of valid) {
    const fetch = sample.diag.fetch || {};
    fetchMax.inflight = Math.max(fetchMax.inflight, fetch.inflight || 0);
    fetchMax.queued = Math.max(fetchMax.queued, fetch.queued || 0);
    fetchMax.active = Math.max(fetchMax.active, fetch.active || 0);
    for (const proc of sample.diag.procs || []) {
      if ((proc.sinceOutputMs || 0) > silencePeak.sinceOutputMs) {
        silencePeak = { sinceOutputMs: proc.sinceOutputMs, pid: proc.pid, command: proc.command, t: sample.t };
      }
    }
  }
  lines.push(
    "  vfs files " + (first.vfs ? first.vfs.files : "?") + " -> " + (last.vfs ? last.vfs.files : "?") +
      "   bytes " + (first.vfs ? Math.round((first.vfs.bytes || 0) / 1048576) : "?") + "MB -> " +
      (last.vfs ? Math.round((last.vfs.bytes || 0) / 1048576) : "?") + "MB" +
      "   fetch max inflight/queued/active " + fetchMax.inflight + "/" + fetchMax.queued + "/" + fetchMax.active +
      "   pendingHttp max " + pendingMax,
  );
  lines.push(
    "  longest proc silence " + (silencePeak.sinceOutputMs / 1000).toFixed(1) + "s at +" +
      (silencePeak.t / 1000).toFixed(1) + "s: PID " + silencePeak.pid + " " + String(silencePeak.command || "").slice(0, 60),
  );
  const finalProcs = (last.procs || []).filter((proc) => !proc.paused).sort((a, b) => a.pid - b.pid);
  lines.push("  live procs at end (" + finalProcs.length + "):");
  for (const proc of finalProcs.slice(0, 10)) {
    lines.push(
      "    PID " + String(proc.pid).padStart(3) + " " + String(proc.command || "").slice(0, 46).padEnd(46) +
        " sinceOutput " + String(proc.sinceOutputMs).padStart(7) + "ms  booted " + (proc.booted ? "y" : "n") +
        (proc.workerErrors ? "  workerErrors " + proc.workerErrors : ""),
    );
  }
  const notes = output
    .map((line) => line.text)
    .join("")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /depcache|optimiz|vite|ready|listening|restart|error|warn/i.test(line))
    .slice(0, 12);
  if (notes.length) {
    lines.push("  in-vm output (" + output.length + " chunks, notable lines):");
    for (const note of notes) lines.push("    " + note.slice(0, 150));
  }
  if (stalled.length) lines.push("  stalls captured: " + stalled.length + " (see stall-*.json)");
  return lines;
}

/** Write summary.txt + in-vm-output.log and return the printed text. */
export function writeSummaryFiles({ outDir, context }) {
  const { devUrl, profileMode, painted, failure, timelineRaw, preview, cpuResult, stalled, samples, output, segmentMs, pageOpenWall } = context;
  const timeline = timelineRaw
    ? bootTimeline(timelineRaw.boot, timelineRaw.timeOrigin, pageOpenWall)
    : { rows: [], missing: [] };
  const phases = phaseStats(timeline.rows, samples, pageOpenWall);
  const lines = [];
  lines.push("Facilis in-VM boot profile — " + new Date().toISOString());
  lines.push(
    "studio " + devUrl + "   profile " + profileMode + "   samples " + samples.length +
      "   painted " + (painted ? "yes" : "NO") + (failure ? "   failure: " + failure : ""),
  );
  lines.push("");
  lines.push(...formatTimeline(timeline));
  lines.push("");
  lines.push(...formatPhases(phases));
  lines.push("");
  lines.push(...formatDiagHighlights({ samples, output, stalled }));
  lines.push("");
  lines.push(...formatTop(cpuResult ? cpuResult.entries : []));
  if (cpuResult) {
    lines.push("");
    lines.push("CPU TARGETS (" + cpuResult.attached.length + " attached; " + segmentMs / 1000 + "s segments)");
    for (const target of cpuResult.attached) {
      lines.push(
        "  " + String(target.label || "?").padEnd(30) + " " + String(target.kind).padEnd(15) + " " +
          (target.profileError ? "ERROR " + target.profileError : "profiled") +
          (target.detached ? " (detached before end)" : ""),
      );
    }
    lines.push("  segments written: " + cpuResult.segments.length + " (cpu-*.cpuprofile)");
  }
  if (timelineRaw && timelineRaw.marks && timelineRaw.marks.length) {
    lines.push("");
    lines.push("perf marks vv:* " + timelineRaw.marks.map((mark) => mark.name + "@" + Math.round(mark.t) + "ms").join(" "));
  }
  if (preview) lines.push("preview iframe " + preview.src + " (" + preview.chars + " chars)");
  lines.push("artifacts: " + outDir);
  const text = lines.join("\n");
  fs.writeFileSync(path.join(outDir, "summary.txt"), text + "\n");
  fs.writeFileSync(path.join(outDir, "in-vm-output.log"), output.map((line) => "[" + line.t + "] " + line.text).join("\n") + "\n");
  return text;
}
