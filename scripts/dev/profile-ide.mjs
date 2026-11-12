// scripts/dev/profile-ide.mjs — where do the in-VM boot seconds actually go?
//
// Boots the real studio (Vivari kernel in Chrome), creates or reopens a project, and
// measures the window the boot marks only bracket: cold npm install in the VM, then vite +
// rolldown starting inside a process worker. Four measurements at once:
//   A) boot timeline from window.__vvBoot with per-milestone deltas;
//   B) 100ms sampler of __vv.diag() + the kernel bridge output stream (term-out/proc-out/
//      log) -> diag.jsonl + in-vm-output.log;
//   C) CPU profiles of the page and every auto-attached worker, recursively (in-VM
//      processes are workers spawned by the kernel worker);
//   D) stall snapshots: no output, VFS growth or non-idle CPU for --stall-ms captures
//      Debugger.pause stacks, fresh CPU segments, screenshot and diag while still frozen.
//
// Usage: node scripts/dev/profile-ide.mjs [--url URL] [--project-name NAME] [--stall-ms 20000]
//          [--sample-ms 100] [--timeout 300000] [--segment-ms 10000] [--max-stalls 4] [--out DIR]
// Env: FACILIS_PROFILE_DIR reuses one profile across runs (its OPFS keeps the dependency
// cache — the cold-vs-warm variable); FACILIS_TOOLING_DIR picks the browser and artifacts.
// A project name that already exists in the reused profile is reopened, not recreated, so
// "warm" measures the same project a reloading user has.
// Artifacts: $FACILIS_TOOLING_DIR/profile-artifacts/<ts>/ (timeline.json, summary.txt,
// diag.jsonl, in-vm-output.log, cpu-*.cpuprofile, final.png, stall-*).

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, openPage } from "./cdp.mjs";
import {
  compactDiag,
  createCpuTracker,
  createProgressWatcher,
  EXPR_INSTALL_OUTPUT,
  EXPR_KERNEL_READY,
  EXPR_MARKS,
  EXPR_SAMPLE,
  EXPR_TIMELINE,
  probeStacks,
  startSampler,
  withTimeout,
  writeSummaryFiles,
} from "./profile-kit.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TOOLING = process.env.FACILIS_TOOLING_DIR || "/tmp/facilis-dev";
const arg = (name, fallback) => {
  const index = process.argv.indexOf("--" + name);
  return index === -1 ? fallback : process.argv[index + 1];
};
const URL_ = arg("url", process.env.STUDIO_URL || "");
const PROJECT_NAME = arg("project-name", "facilis-prof");
const STALL_MS = Number(arg("stall-ms", 20000));
const SAMPLE_MS = Number(arg("sample-ms", 100));
const SEGMENT_MS = Number(arg("segment-ms", 10000));
const TIMEOUT_MS = Number(arg("timeout", 300000));
const BOOT_TIMEOUT_MS = Number(arg("boot-timeout", 180000));
const MAX_STALLS = Number(arg("max-stalls", 4));
const SAMPLING_US = Number(arg("sampling-us", 1000));
const OUT = arg("out", path.join(TOOLING, "profile-artifacts", String(Date.now())));
const CHROME = process.env.FACILIS_CHROME || path.join(TOOLING, "browser/chrome/chrome");
const SYSROOT = process.env.FACILIS_BROWSER_SYSROOT || path.join(TOOLING, "browser/sysroot");
const FONTCONFIG = process.env.FACILIS_FONTCONFIG || path.join(TOOLING, "browser/fonts.conf");
const T0 = Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sinceT0 = () => Date.now() - T0;
const log = (message) => console.log("[" + new Date().toISOString().slice(11, 23) + "] +" + (sinceT0() / 1000).toFixed(1) + "s " + message);
const shortError = (error) => String((error && error.message) || error).slice(0, 240);

async function waitForHttp(url, limitMs) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch {
      /* not listening yet */
    }
    await sleep(500);
  }
  throw new Error("dev server did not answer " + url + " within " + limitMs + "ms");
}

// An IDE already listening on the documented dev port is reused and left alone; only a
// server this script started is stopped at the end.
async function ensureDevServer() {
  if (URL_) return { url: URL_.endsWith("/") ? URL_ : URL_ + "/", child: null };
  const url = "http://127.0.0.1:5173/";
  let already = false;
  try {
    already = (await fetch(url, { signal: AbortSignal.timeout(1500) })).status < 500;
  } catch {
    already = false;
  }
  if (already) {
    log("using the IDE already listening at " + url);
    return { url, child: null };
  }
  log("starting pnpm ide dev on " + url);
  const child = spawn(
    "pnpm",
    ["--filter", "@facilis.dev/ide", "dev", "--host", "127.0.0.1", "--port", "5173", "--strictPort"],
    { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (output += chunk.toString()));
  child.on("exit", (code) => {
    if (code !== 0) log("ide dev exited " + code + "\n" + output.slice(-1200));
  });
  await waitForHttp(url, 120000);
  return { url, child };
}

function stopDevServer(child) {
  if (!child) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profileDir = path.join(OUT, "profile");
  const reusedProfile = Boolean(process.env.FACILIS_PROFILE_DIR);
  let profileMode = "cold (throwaway)";
  if (reusedProfile) {
    const warm = fs.existsSync(path.join(process.env.FACILIS_PROFILE_DIR, "Default"));
    profileMode = (warm ? "warm" : "cold (profile dir new)") + " (" + process.env.FACILIS_PROFILE_DIR + ")";
  }
  log("artifacts " + OUT);
  log("profile " + profileMode);
  const dev = await ensureDevServer();
  log("studio " + dev.url);
  if (!fs.existsSync(CHROME)) throw new Error("chrome not found: " + CHROME + " (run scripts/dev/fetch-browser.sh)");
  // A backgrounded headless page must not be timer-throttled: the numbers are the point.
  const flags = JSON.parse(process.env.FACILIS_CHROME_FLAGS_JSON || "[]");
  for (const flag of ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"]) {
    if (!flags.includes(flag)) flags.push(flag);
  }
  process.env.FACILIS_CHROME_FLAGS_JSON = JSON.stringify(flags);

  let chrome = null;
  let page = null;
  let tracker = null;
  let sampler = null;
  let segTimer = null;
  let painted = false;
  let failure = null;
  let timelineRaw = null;
  let preview = null;
  let cpuResult = null;
  const stalled = [];
  const paused = new Map();
  let pageOpenWall = Date.now();
  let stallBusy = false;

  try {
    chrome = await launchChrome({
      chrome: CHROME,
      profileDir,
      homeDir: path.join(OUT, "home"),
      sysroot: fs.existsSync(SYSROOT) ? SYSROOT : "",
      fontconfigFile: fs.existsSync(FONTCONFIG) ? FONTCONFIG : "",
    });
    tracker = createCpuTracker(chrome.client, { outDir: OUT, samplingUs: SAMPLING_US });
    chrome.client.on((message) => {
      if (message.method === "Debugger.paused") paused.set(message.sessionId, message.params);
    });
    pageOpenWall = Date.now();
    page = await openPage(chrome.client, dev.url);
    await tracker.trackPage(page.sessionId, dev.url);
    log("page open, profilers on");

    // Subscribe to the kernel bridge's output before the kernel boots: that stream is the
    // VM's real console (terminal lines, depcache/vite logs) and the progress signal.
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        if (await withTimeout(page.evaluate(EXPR_INSTALL_OUTPUT), 3000, "install-output")) break;
      } catch {
        /* page still starting */
      }
      await sleep(100);
    }

    const watcher = createProgressWatcher({ stallMs: STALL_MS, maxStalls: MAX_STALLS });
    const captureStall = async (stall) => {
      const n = stalled.length + 1;
      log("STALL #" + n + ": no output, VFS growth or CPU activity for " + (stall.sinceProgressMs / 1000).toFixed(1) + "s — capturing while frozen");
      const snapshot = {
        n,
        at: new Date().toISOString(),
        msSinceRunStart: sinceT0(),
        sinceProgressMs: stall.sinceProgressMs,
        lastSample: stall.sample,
        outputTail: sampler.output().slice(-30),
        stacks: [],
        profiles: [],
        screenshot: null,
      };
      try {
        snapshot.diag = compactDiag(await withTimeout(page.evaluate(EXPR_SAMPLE), 6000, "stall-diag"), null);
      } catch (caught) {
        snapshot.diagUnavailable = shortError(caught);
      }
      try {
        snapshot.stacks = await probeStacks(chrome.client, paused, tracker.targets());
      } catch (caught) {
        snapshot.stacksError = shortError(caught);
      }
      const made = await tracker.rotate("stall", true, true).catch(() => []);
      for (const segment of made) {
        const file = "stall-" + n + "-cpu-" + segment.label + ".cpuprofile";
        fs.writeFileSync(path.join(OUT, file), JSON.stringify(segment.profile));
        snapshot.profiles.push(file);
      }
      try {
        const file = path.join(OUT, "stall-" + n + ".png");
        await withTimeout(page.screenshot(file), 10000, "screenshot");
        snapshot.screenshot = path.basename(file);
      } catch (caught) {
        snapshot.screenshotError = shortError(caught);
      }
      fs.writeFileSync(path.join(OUT, "stall-" + n + ".json"), JSON.stringify(snapshot, null, 2));
      stalled.push(snapshot);
      const stacks = snapshot.stacks.filter((entry) => entry.frames.length > 0).length;
      log("  stall #" + n + " saved: " + stacks + " stacks, " + snapshot.profiles.length + " profiles");
    };

    sampler = startSampler(page, {
      outDir: OUT,
      sampleMs: SAMPLE_MS,
      onSample: (sample) => {
        if (stallBusy) return;
        const stall = watcher.observe(sample, tracker.activity());
        if (!stall) return;
        stallBusy = true;
        void captureStall(stall).finally(() => {
          stallBusy = false;
        });
      },
    });
    segTimer = setInterval(() => void tracker.rotate("segment"), SEGMENT_MS);

    const untilBoot = Date.now() + BOOT_TIMEOUT_MS;
    let ready = false;
    while (Date.now() < untilBoot) {
      try {
        ready = await withTimeout(page.evaluate(EXPR_KERNEL_READY), 5000, "kernel-ready");
      } catch {
        ready = false;
      }
      if (ready) break;
      await sleep(250);
    }
    if (!ready) throw new Error("kernelReady did not appear within " + BOOT_TIMEOUT_MS + "ms");
    log("kernel ready at +" + ((Date.now() - T0) / 1000).toFixed(1) + "s");

    const projectDir = await withTimeout(
      page.evaluate("window.__ide.defaultDirFor(" + JSON.stringify(PROJECT_NAME) + ")"),
      5000,
      "default-dir",
    );
    const recents = await withTimeout(
      page.evaluate("window.__ide.getSnapshot().recentProjects.map((p) => p.rootPath)"),
      5000,
      "recents",
    );
    const reopen = Array.isArray(recents) && recents.includes(projectDir);
    log((reopen ? "reopening " : "creating ") + projectDir);
    if (reopen) {
      await withTimeout(
        page.evaluate(
          "(async () => { const meta = window.__ide.getSnapshot().recentProjects.find((p) => p.rootPath === " +
            JSON.stringify(projectDir) +
            "); await window.__ide.openProject(meta);" +
            " await window.__ide.bridge.request('vv-ensure-deps', { dir: meta.rootPath });" +
            " window.__ide.runProject(meta.rootPath); return true; })()",
        ),
        180000,
        "reopen-project",
      );
    } else {
      await withTimeout(
        page.evaluate(
          "(async () => { await window.__ide.createProject({ dir: " +
            JSON.stringify(projectDir) +
            ", runInit: true }); return true; })()",
        ),
        180000,
        "create-project",
      );
    }

    const untilPaint = Date.now() + TIMEOUT_MS;
    let marks = [];
    let lastLog = 0;
    while (Date.now() < untilPaint) {
      try {
        marks = await withTimeout(page.evaluate(EXPR_MARKS), 6000, "marks");
      } catch {
        marks = [];
      }
      if (marks.includes("preview-paint")) {
        painted = true;
        break;
      }
      if (Date.now() - lastLog > 5000) {
        lastLog = Date.now();
        const sample = sampler.lastSample();
        const procs = sample && sample.diag && sample.diag.procs ? sample.diag.procs.length : 0;
        log("+" + ((Date.now() - T0) / 1000).toFixed(1) + "s marks [" + marks.join(",") + "] procs " + procs + " output " + (sample ? sample.outputCount : 0));
      }
      await sleep(250);
    }
    if (painted) await sleep(1500);
    timelineRaw = await withTimeout(page.evaluate(EXPR_TIMELINE), 8000, "timeline");
    try {
      preview = await withTimeout(
        page.evaluate(
          "(() => { const frame = [...document.querySelectorAll('iframe')].find((f) => /preview/.test(f.src || ''));" +
            " return frame ? { src: frame.src, chars: (() => { try { return frame.contentDocument && frame.contentDocument.body ? frame.contentDocument.body.innerText.length : 0; } catch { return -1; } })() } : null; })()",
        ),
        8000,
        "preview",
      );
    } catch {
      preview = null;
    }
    try {
      await withTimeout(page.screenshot(path.join(OUT, "final.png")), 15000, "screenshot");
    } catch {
      /* a wedged renderer may not paint */
    }
  } catch (error) {
    failure = shortError(error);
    log("FAILED: " + failure);
  } finally {
    if (segTimer) clearInterval(segTimer);
    if (sampler) sampler.stop();
    try {
      if (tracker) cpuResult = await tracker.finalize();
    } catch (error) {
      log("cpu finalize failed: " + shortError(error));
    }
    const timeline = timelineRaw || { boot: [], timeOrigin: 0, marks: [], nav: null };
    fs.writeFileSync(path.join(OUT, "timeline.json"), JSON.stringify({ url: dev.url, profileMode, painted, failure, pageOpenWall, ...timeline, preview, stalls: stalled, cpu: cpuResult ? { attached: cpuResult.attached, segments: cpuResult.segments } : null }, null, 2));
    const text = writeSummaryFiles({
      outDir: OUT,
      context: {
        devUrl: dev.url,
        profileMode,
        painted,
        failure,
        timelineRaw,
        preview,
        cpuResult,
        stalled,
        samples: sampler ? sampler.samples() : [],
        output: sampler ? sampler.output() : [],
        segmentMs: SEGMENT_MS,
        pageOpenWall,
      },
    });
    console.log("\n" + text + "\n");
    if (chrome) {
      chrome.client.close();
      chrome.child.kill("SIGKILL");
    }
    stopDevServer(dev.child);
    process.exitCode = painted && !failure ? 0 : 1;
  }
}

await main();