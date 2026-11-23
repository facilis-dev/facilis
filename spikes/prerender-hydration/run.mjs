#!/usr/bin/env node
/**
 * Spike runner (issue #80): prove Node-only prerender + hydration INSIDE the
 * WebContainer, on both template stacks (Vite 7 / Vite 8 + rolldown wasm).
 *
 * Drives the real Studio through CDP (scripts/dev/cdp.mjs), nothing mocked:
 *   boot kernel -> materialize the spike project (vv-create-project, custom
 *   manifest) -> in-VM npm install -> per-arm measured vite build (proc-spawn)
 *   -> read the emitted HTML from the VFS -> serve the build in-VM -> verify
 *   hydration in a real browser preview (pop-out preview pages + IDE preview).
 *
 * The IDE itself is UNCHANGED by this spike: by default it runs from the main
 * checkout (its gitignored wasm/vendor artifacts live there); spike files come
 * from this worktree. Override with --ide-repo.
 *
 * Usage: node spikes/prerender-hydration/run.mjs [--arms a,b,c] [--variants vite7,vite8]
 * Artifacts: $FACILIS_TOOLING_DIR/spike-prerender-hydration/<timestamp>/
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchChrome, openPage } from "../../scripts/dev/cdp.mjs";

const SPIKE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(SPIKE, "../..");
const TOOLING = process.env.FACILIS_TOOLING_DIR || "/tmp/facilis-dev";
const ARTIFACTS = path.join(TOOLING, "spike-prerender-hydration", String(Date.now()));
const CHROME = process.env.FACILIS_CHROME || path.join(TOOLING, "browser/chrome/chrome");
const SYSROOT = process.env.FACILIS_BROWSER_SYSROOT || path.join(TOOLING, "browser/sysroot");
const FONTCONFIG = process.env.FACILIS_FONTCONFIG || path.join(TOOLING, "browser/fonts.conf");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const ARMS = flag("arms", "a,b,c").split(",").map((s) => s.trim()).filter(Boolean);
const VARIANTS = flag("variants", "vite7,vite8").split(",").map((s) => s.trim()).filter(Boolean);
const IDE_REPO = path.resolve(flag("ide-repo", mainCheckout()));
const PROJECT_NAME = flag("project", "spike-prerender-" + Date.now().toString(36));
const DIR = "/home/user/projects/" + PROJECT_NAME;

const BOOT_TIMEOUT_MS = Number(process.env.SPIKE_BOOT_TIMEOUT_MS || 240000);
const INSTALL_TIMEOUT_MS = Number(process.env.SPIKE_INSTALL_TIMEOUT_MS || 420000);
const BUILD_TIMEOUT_MS = Number(process.env.SPIKE_BUILD_TIMEOUT_MS || 300000);
const PREVIEW_TIMEOUT_MS = Number(process.env.SPIKE_PREVIEW_TIMEOUT_MS || 45000);

function mainCheckout() {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: REPO, encoding: "utf8",
    }).trim();
    return common.endsWith(".git") ? path.dirname(common) : REPO;
  } catch {
    return REPO;
  }
}

const checks = [];
const record = (ok, label, detail = "") => {
  checks.push({ ok, label, detail });
  console.log((ok ? "PASS " : "FAIL ") + label + (detail ? "  " + detail : ""));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── spike files ─────────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(["node_modules", "dist", ".output", ".spike", ".vite-cache", ".turbo"]);
function collectAppFiles() {
  const files = {};
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), rel + entry.name + "/");
      } else if (entry.name !== "package-lock.json" && !entry.name.startsWith("package.vite")) {
        files[rel + entry.name] = fs.readFileSync(path.join(dir, entry.name), "utf8");
      }
    }
  };
  walk(path.join(SPIKE, "app"), "");
  return files;
}
const APP_FILES = collectAppFiles();

// ── dev server ──────────────────────────────────────────────────────────────
async function freePort(from) {
  for (let port = from; port < from + 20; port++) {
    const free = await new Promise((resolve) => {
      const probe = net.createServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port, "127.0.0.1");
    });
    if (free) return port;
  }
  throw new Error("no free port from " + from);
}
async function waitForHttp(url, limitMs) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not up yet */ }
    await sleep(500);
  }
  return false;
}
async function startDevServer() {
  const port = await freePort(5199);
  const url = "http://127.0.0.1:" + port + "/";
  const child = spawn(
    "pnpm",
    ["--filter", "@facilis.dev/ide", "dev", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: IDE_REPO, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  let log = "";
  child.stdout.on("data", (c) => (log += c.toString()));
  child.stderr.on("data", (c) => (log += c.toString()));
  if (!(await waitForHttp(url, 180000))) throw new Error("IDE dev server did not start:\n" + log.slice(-3000));
  return { url, child, log: () => log };
}

// ── page helpers ────────────────────────────────────────────────────────────
async function waitFor(page, expression, limitMs, step = 500) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    if (await page.evaluate(expression).catch(() => false)) return true;
    await sleep(step);
  }
  return false;
}
const readFile = (page, abs) =>
  page.evaluate("window.__ide.readFileText(" + JSON.stringify(abs) + ")").catch(() => null);
const writeFile = (page, abs, contents) =>
  page.evaluate(
    "window.__ide.bridge.request('vv-write', { path: " + JSON.stringify(abs) +
    ", contents: " + JSON.stringify(contents) + " })",
  );
const readDir = (page, abs) =>
  page.evaluate("window.__ide.bridge.request('vv-readdir', { path: " + JSON.stringify(abs) + " })").catch(() => null);

// Page-side proc collector: bridge events land in a map the host polls.
const INSTALL_COLLECTOR = `
(() => {
  if (window.__spikeProcs) return 'already';
  window.__spikeProcs = {};
  const b = window.__ide.bridge;
  b.on('proc-out', (m) => {
    const p = window.__spikeProcs[m.execId];
    if (p && typeof m.chunk === 'string') p.output += m.chunk;
  });
  b.on('proc-exit', (m) => {
    const p = window.__spikeProcs[m.execId];
    if (p) { p.code = typeof m.code === 'number' ? m.code : null; p.done = true; }
  });
  return 'installed';
})()`;

let procSeq = 0;
async function vmSpawn(page, { command, args, cwd, env, timeoutMs, label }) {
  const execId = "spike-" + ++procSeq + "-" + label;
  const t0 = Date.now();
  await page.evaluate(
    "(() => { window.__spikeProcs[" + JSON.stringify(execId) + "] = { output: '', code: null, done: false };" +
    " window.__ide.bridge.post('proc-spawn', { execId: " + JSON.stringify(execId) +
    ", command: " + JSON.stringify(command) + ", args: " + JSON.stringify(args) +
    ", cwd: " + JSON.stringify(cwd) + (env ? ", env: " + JSON.stringify(env) : "") + " }); return true; })()",
  );
  const until = Date.now() + timeoutMs;
  let state = { done: false, code: null, tail: "", len: 0 };
  while (Date.now() < until) {
    state = await page.evaluate(
      "(() => { const p = window.__spikeProcs[" + JSON.stringify(execId) + "];" +
      " return { done: p.done, code: p.code, tail: p.output.slice(-6000), len: p.output.length }; })()",
    ).catch(() => state);
    if (state.done) break;
    await sleep(1500);
  }
  const full = await page.evaluate(
    "(window.__spikeProcs[" + JSON.stringify(execId) + "] || { output: '' }).output.slice(-60000)",
  ).catch(() => state.tail);
  fs.writeFileSync(path.join(ARTIFACTS, "proc-" + execId + ".log"), full);
  if (!state.done) {
    await page.evaluate("window.__ide.bridge.post('proc-kill', { execId: " + JSON.stringify(execId) + " })").catch(() => {});
  }
  return { execId, code: state.code, output: full, wallMs: Date.now() - t0, timedOut: !state.done };
}

// Long-running server: spawn without waiting for exit; readiness probed in-VM.
async function vmServe(page, { command, args, cwd, label }) {
  const execId = "spike-serve-" + ++procSeq + "-" + label;
  await page.evaluate(
    "(() => { window.__spikeProcs[" + JSON.stringify(execId) + "] = { output: '', code: null, done: false };" +
    " window.__ide.bridge.post('proc-spawn', { execId: " + JSON.stringify(execId) +
    ", command: " + JSON.stringify(command) + ", args: " + JSON.stringify(args) +
    ", cwd: " + JSON.stringify(cwd) + " }); return true; })()",
  );
  return execId;
}
async function vmKill(page, execId) {
  await page.evaluate("window.__ide.bridge.post('proc-kill', { execId: " + JSON.stringify(execId) + " })").catch(() => {});
  await sleep(800);
  const tail = await page.evaluate(
    "(window.__spikeProcs[" + JSON.stringify(execId) + "] || { output: '' }).output.slice(-8000)",
  ).catch(() => "");
  fs.writeFileSync(path.join(ARTIFACTS, "proc-" + execId + ".log"), tail);
  return tail;
}
async function waitPortInVm(page, port, limitMs) {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    const probe = await vmSpawn(page, {
      command: "node",
      args: ["-e", "fetch('http://127.0.0.1:" + port + "/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"],
      cwd: DIR, timeoutMs: 15000, label: "probe",
    });
    if (probe.code === 0) return true;
    await sleep(1500);
  }
  return false;
}

const HYDRATION_EXPR = `(() => ({
  ready: window.__PRERENDER_READY__ === true,
  mode: window.__PRERENDER_MODE__ || null,
  errors: window.__PRERENDER_ERRORS__ || null,
  title: document.title,
  home: !!document.getElementById('home-content'),
  stats: !!document.getElementById('stats-content'),
  statsSource: (document.getElementById('stats-content') || {}).dataset
    ? document.getElementById('stats-content').dataset.source || null : null,
  statsText: ((document.getElementById('stats-content') || {}).textContent || '').slice(0, 200),
  authShell: !!document.getElementById('auth-shell'),
  rootChildren: document.getElementById('root') ? document.getElementById('root').childElementCount : 0,
}))()`;

async function previewUrl(page, port, route) {
  return page.evaluate(
    "window.__ide.bridge.previewUrlFor(" + port + ", " + JSON.stringify(route) + ")",
  );
}

async function checkHydration(chrome, ideUrl, page, port, route, expect, label) {
  const rel = await previewUrl(page, port, route);
  const url = rel.startsWith("http") ? rel : ideUrl.replace(/\/$/, "") + rel;
  const pop = await openPage(chrome.client, url);
  try {
    await waitFor(pop, "(window.__PRERENDER_READY__ === true || (window.__PRERENDER_ERRORS__ || []).length > 0)", PREVIEW_TIMEOUT_MS, 500);
    await sleep(1200);
    const snap = await pop.evaluate(HYDRATION_EXPR).catch(() => null);
    // Visual evidence: the pop-out page IS the real browser render of the
    // served document (the IDE workspace stays on Home — the spike project is
    // materialized by RPC, never opened as a workspace folder).
    await pop.screenshot(path.join(ARTIFACTS, "page-" + label + route.replace(/\//g, "-") + ".png")).catch(() => {});
    const errors = snap && Array.isArray(snap.errors) ? snap.errors : ["<no snapshot>"];
    const ok = Boolean(
      snap && snap.ready && errors.length === 0 &&
      snap.mode === expect.mode &&
      (expect.home ? snap.home : !snap.home) &&
      (expect.stats ? snap.stats && snap.statsSource === "prerender" : !snap.stats) &&
      (expect.authShell ? snap.authShell : !snap.authShell) &&
      snap.title === expect.title,
    );
    return { ok, snap, errors, url };
  } finally {
    await pop.send("Page.close").catch(() => {});
  }
}

// ── HTML assertions on the build output (VFS reads) ─────────────────────────
async function findHtml(page, candidates) {
  for (const rel of candidates) {
    const text = await readFile(page, DIR + "/" + rel);
    if (typeof text === "string" && text.length > 0) return { rel, text };
  }
  return { rel: null, text: "" };
}
function assertPrerenderedHtml(html, route) {
  const problems = [];
  const isHome = route === "/";
  const marker = isHome ? 'id="home-content"' : 'id="stats-content"';
  const title = isHome ? "Home — Prerender Spike" : "Stats — Prerender Spike";
  if (!html.includes(marker)) problems.push("missing " + marker);
  if (!html.includes("<title>" + title + "</title>")) problems.push("missing per-route title");
  if (!isHome && !html.includes('data-source="prerender"')) problems.push("stats not marked prerendered");
  if (!isHome && !html.includes("alpha")) problems.push("stats data missing");
  if (html.includes('id="auth-shell"')) problems.push("auth shell leaked into a prerendered page");
  if (/unauthorized|"statusCode":401|"status":401/.test(html)) problems.push("error body written as a page");
  if (!html.includes('id="prerender-data"')) problems.push("missing state island");
  return problems;
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  console.log("artifacts: " + ARTIFACTS);
  console.log("ide repo:  " + IDE_REPO);
  console.log("spike dir: " + DIR);
  console.log("arms: " + ARMS.join(",") + "  variants: " + VARIANTS.join(","));

  let dev = null, chrome = null, page = null;
  const report = {
    ok: false, startedAt: new Date().toISOString(), dir: DIR, ideRepo: IDE_REPO,
    arms: ARMS, variants: VARIANTS, checks, timings: {}, results: [],
    consoleErrors: [], pageErrors: [], bootMarks: [],
  };

  try {
    dev = await startDevServer();
    console.log("studio url: " + dev.url);
    if (!fs.existsSync(CHROME)) throw new Error("chrome not found: " + CHROME + " (run pnpm ide:browser)");
    chrome = await launchChrome({
      chrome: CHROME,
      profileDir: process.env.FACILIS_PROFILE_DIR || path.join(ARTIFACTS, "profile"),
      homeDir: path.join(ARTIFACTS, "home"),
      sysroot: fs.existsSync(SYSROOT) ? SYSROOT : "",
      fontconfigFile: fs.existsSync(FONTCONFIG) ? FONTCONFIG : "",
    });
    page = await openPage(chrome.client, dev.url);

    const t0 = Date.now();
    const booted = await waitFor(page, "((window.__vvBoot || []).some((m) => m.name === 'kernel-online'))", BOOT_TIMEOUT_MS);
    report.timings.kernelOnlineMs = Date.now() - t0;
    record(booted, "kernel online", report.timings.kernelOnlineMs + "ms");
    if (!booted) throw new Error("kernel never came online");
    await sleep(1500);
    await page.evaluate(INSTALL_COLLECTOR);

    // Materialize the spike project directly (no template, no run pipeline).
    const manifest = {
      id: "prerender-spike", name: "Prerender Spike", entry: "src/app.tsx",
      hmr: false, reload: false, install: "npm install", dev: "npm run dev",
      port: 3000, assets: [],
    };
    const created = await page.evaluate(
      "window.__ide.bridge.request('vv-create-project', { dir: " + JSON.stringify(DIR) +
      ", files: " + JSON.stringify(APP_FILES) + ", manifest: " + JSON.stringify(manifest) +
      ", title: 'Prerender hydration spike' })",
    );
    record(Boolean(created && created.ok), "spike project materialized", DIR);
    if (!created || !created.ok) throw new Error("vv-create-project failed: " + JSON.stringify(created));

    for (const variant of VARIANTS) {
      const pkg = fs.readFileSync(path.join(SPIKE, "app", "package." + variant + ".json"), "utf8");
      await writeFile(page, DIR + "/package.json", pkg);
      const install = await vmSpawn(page, { command: "npm", args: ["install"], cwd: DIR, timeoutMs: INSTALL_TIMEOUT_MS, label: "install-" + variant });
      report.timings["install_" + variant + "_ms"] = install.wallMs;
      record(install.code === 0, variant + ": npm install in-VM", install.wallMs + "ms, exit " + install.code);
      if (install.code !== 0) {
        report.results.push({ variant, installFailed: true, tail: install.output.slice(-2500) });
        continue;
      }

      // Resolution facts: the kernel aliases native packages to wasm drop-ins
      // at fetch time (esbuild -> esbuild-wasm, rollup -> rolldown). Record what
      // actually landed, so "accidental rolldown" on the Vite 7 path is visible.
      const resolutions = {};
      for (const name of ["vite", "rollup", "esbuild", "rolldown", "nitro", "@rolldown/binding-wasm32-wasi"]) {
        const text = await readFile(page, DIR + "/node_modules/" + name + "/package.json");
        try {
          const pj = JSON.parse(String(text));
          resolutions[name] = pj.name + "@" + pj.version;
        } catch {
          resolutions[name] = "<absent>";
        }
      }
      record(true, variant + ": in-VM resolutions", JSON.stringify(resolutions));

      // Minifier probe: does the variant's default minifier run in-VM at all?
      const minify = await vmSpawn(page, {
        command: "node",
        // No process.exit inside the promise handlers: the VM surfaces exit as
        // a catchable unwind, which a .catch would misreport as a build failure.
        args: ["-e", "import('vite').then((v) => v.build({ configFile: false, configLoader: 'native', logLevel: 'warn', build: { minify: true, write: false, rollupOptions: { input: 'src/lib/routes.ts' } } })).then(() => console.log('MINIFY_OK'), (e) => console.log('MINIFY_FAIL ' + (e && e.message)))"],
        cwd: DIR, timeoutMs: 120000, label: "minify-" + variant,
      });
      const minifyOk = minify.output.includes("MINIFY_OK");
      record(minifyOk, variant + ": default minifier build probe", minifyOk ? "ok" : minify.output.slice(-300));

      for (const arm of ARMS) {
        const tag = variant + "-arm-" + arm;
        console.log("\n== " + tag + " ==");
        await writeFile(page, DIR + "/spike-arm.txt", arm + "\n");
        // Nitro renderer modes: with an index.html present, Nitro serves it as
        // the renderer TEMPLATE (outlet injection); the official vite-ssr-react
        // mode — entry-server's fetch returns the whole document — requires NO
        // index.html. Arm A removes it; arms B/C need it as their SPA template.
        if (arm === "a") {
          await page.evaluate(
            "window.__ide.bridge.request('vv-rm', { path: " + JSON.stringify(DIR + "/index.html") + " })",
          );
        } else {
          await writeFile(page, DIR + "/index.html", APP_FILES["index.html"]);
        }
        const diagSamples = [];
        const sampler = setInterval(() => {
          page.evaluate("(window.__vv.diag ? window.__vv.diag() : null)").then((d) => {
            if (d) diagSamples.push({ at: Date.now(), diag: d });
          }).catch(() => {});
        }, 3000);
        const build = await vmSpawn(page, { command: "node", args: ["scripts/build-measured.mjs"], cwd: DIR, timeoutMs: BUILD_TIMEOUT_MS, label: "build-" + tag });
        clearInterval(sampler);
        fs.writeFileSync(path.join(ARTIFACTS, "diag-" + tag + ".json"), JSON.stringify(diagSamples.slice(-40), null, 2));
        const buildReportRaw = await readFile(page, DIR + "/.spike/build-report.json");
        let buildReport = null;
        try { buildReport = JSON.parse(String(buildReportRaw)); } catch { /* missing */ }
        record(build.code === 0, tag + ": vite build in-VM", build.wallMs + "ms, exit " + build.code +
          (buildReport ? ", peakRss " + buildReport.peakRssMb + "MB, heap " + buildReport.peakHeapUsedMb + "MB" : ""));
        const entry = { variant, arm, build: buildReport, buildExit: build.code, buildWallMs: build.wallMs, buildTail: build.output.slice(-3000), minifyOk, resolutions, html: null, hydration: null };
        report.results.push(entry);
        if (build.code !== 0) continue;

        // HTML facts from the VFS.
        const outBase = arm === "a" ? ".output/public" : "dist";
        const home = await findHtml(page, [outBase + "/index.html"]);
        const stats = await findHtml(page, [outBase + "/stats/index.html", outBase + "/stats.html"]);
        const appHtml = await findHtml(page, [outBase + "/app/index.html", outBase + "/app.html"]);
        const listing = await readDir(page, DIR + "/" + outBase);
        const problems = [
          ...assertPrerenderedHtml(home.text, "/"),
          ...assertPrerenderedHtml(stats.text, "/stats"),
        ];
        if (appHtml.rel) problems.push("/app was prerendered: " + appHtml.rel);
        entry.html = { home: home.rel, stats: stats.rel, app: appHtml.rel, problems, listing: listing && (listing.entries || listing.files || listing) };
        record(problems.length === 0, tag + ": prerendered HTML facts", problems.length ? problems.join("; ") : home.rel + " + " + stats.rel + ", no /app page");
        fs.writeFileSync(path.join(ARTIFACTS, "html-" + tag + "-home.html"), home.text);
        fs.writeFileSync(path.join(ARTIFACTS, "html-" + tag + "-stats.html"), stats.text);

        // Serve the build in-VM and verify hydration in a real browser.
        const serve = arm === "a"
          ? { command: "node", args: ["scripts/serve-nitro.mjs", "4173"] }
          : arm === "b"
            ? { command: "npm", args: ["run", "preview", "--", "--port", "4173", "--strictPort", "--host", "127.0.0.1"] }
            : { command: "node", args: ["scripts/serve-dist.mjs", "dist", "4173"] };
        const execId = await vmServe(page, { ...serve, cwd: DIR, label: tag });
        const up = await waitPortInVm(page, 4173, 40000);
        record(up, tag + ": preview server up in-VM (4173)");
        if (up) {
          // Served-HTML proof: fetch from INSIDE the VM (direct to the preview
          // server, no SW involved) — host-context fetches through the preview
          // SW are not reliably frame-routed and are not the spike's question.
          const rawFetch = (route) => vmSpawn(page, {
            command: "node",
            args: ["-e", "fetch('http://127.0.0.1:4173" + route + "').then((r) => r.text()).then((t) => console.log(t)).catch(() => process.exit(1))"],
            cwd: DIR, timeoutMs: 20000, label: "raw" + route.replace(/\//g, "-") + "-" + tag,
          });
          const rawHome = await rawFetch("/");
          const rawStats = await rawFetch("/stats");
          const rawOk = rawHome.output.includes('id="home-content"') &&
            rawStats.output.includes('id="stats-content"') &&
            !rawHome.output.includes('id="auth-shell"') &&
            !rawStats.output.includes('id="auth-shell"');
          entry.raw = { ok: rawOk, homeHead: rawHome.output.slice(0, 160), statsHead: rawStats.output.slice(0, 160) };
          record(rawOk, tag + ": served raw HTML carries content");
          // IDE-integrated preview + screenshot evidence.
          await page.evaluate("window.__ide.preview.pointPreview(4173)").catch(() => {});
          await sleep(3000);
          await page.screenshot(path.join(ARTIFACTS, "preview-" + tag + ".png")).catch(() => {});
          const homeHy = await checkHydration(chrome, dev.url, page, 4173, "/", { mode: "hydrate", home: true, stats: false, authShell: false, title: "Home — Prerender Spike" }, tag);
          const statsHy = await checkHydration(chrome, dev.url, page, 4173, "/stats", { mode: "hydrate", home: false, stats: true, authShell: false, title: "Stats — Prerender Spike" }, tag);
          const appHy = await checkHydration(chrome, dev.url, page, 4173, "/app", { mode: "client", home: false, stats: false, authShell: true, title: "Prerender Spike" }, tag);
          entry.hydration = { home: homeHy, stats: statsHy, app: appHy };
          record(homeHy.ok, tag + ": / hydrates, zero recoverable errors", JSON.stringify(homeHy.errors).slice(0, 200));
          record(statsHy.ok, tag + ": /stats hydrates with prerendered data", JSON.stringify(statsHy.errors).slice(0, 200));
          record(appHy.ok, tag + ": /app stays a client-only shell", "mode=" + (appHy.snap && appHy.snap.mode));
        }
        entry.serveLog = (await vmKill(page, execId)).slice(-2500);
        // The next arm needs the port FREE: a surviving preview child would
        // answer the next arm's probes with stale content. Wait until the
        // in-VM fetch probe fails (connection refused), bounded.
        const freeUntil = Date.now() + 15000;
        let freed = false;
        while (Date.now() < freeUntil) {
          const probe = await vmSpawn(page, {
            command: "node",
            args: ["-e", "fetch('http://127.0.0.1:4173/').then(() => process.exit(1)).catch(() => process.exit(0))"],
            cwd: DIR, timeoutMs: 15000, label: "portfree",
          });
          if (probe.code === 0) { freed = true; break; }
          await vmKill(page, execId);
          await sleep(1500);
        }
        entry.portFreed = freed;
        if (!freed) record(false, tag + ": preview port released", "port 4173 still answering after kill");
      }
    }

    report.bootMarks = await page.evaluate("(window.__vvBoot || []).map((m) => ({ name: m.name, t: m.t }))").catch(() => []);
    report.consoleErrors = page.consoleEntries.filter((e) => e.type === "error").slice(-40);
    report.pageErrors = page.pageErrors.slice(-20);
    await page.screenshot(path.join(ARTIFACTS, "99-final.png")).catch(() => {});
  } catch (error) {
    record(false, "spike crashed", error instanceof Error ? error.message.slice(0, 800) : String(error));
  } finally {
    report.ok = checks.some((c) => c.ok && /: \/stats hydrates/.test(c.label)) &&
      report.results.some((r) => r.buildExit === 0 && r.html && r.html.problems.length === 0 &&
        r.hydration && r.hydration.home.ok && r.hydration.stats.ok && r.hydration.app.ok);
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(ARTIFACTS, "report.json"), JSON.stringify(report, null, 2));
    if (chrome) {
      try { chrome.child.kill("SIGKILL"); } catch { /* ignore */ }
      try { chrome.client.close(); } catch { /* ignore */ }
    }
    if (dev) {
      try { process.kill(-dev.child.pid, "SIGTERM"); } catch {
        try { dev.child.kill("SIGTERM"); } catch { /* already gone */ }
      }
    }
  }

  console.log("\n== summary ==");
  for (const r of report.results) {
    console.log([r.variant, "arm-" + r.arm, "build=" + r.buildExit,
      "html=" + (r.html ? (r.html.problems.length === 0 ? "ok" : r.html.problems.length + " problems") : "n/a"),
      "hydration=" + (r.hydration ? [r.hydration.home.ok, r.hydration.stats.ok, r.hydration.app.ok].map((b) => (b ? "y" : "n")).join("") : "n/a"),
      r.build ? r.build.wallMs + "ms/" + r.build.peakRssMb + "MB" : ""].join(" "));
  }
  console.log("overall: " + (report.ok ? "PASS" : "FAIL") + "  report: " + path.join(ARTIFACTS, "report.json"));
  process.exit(report.ok ? 0 : 1);
}

main();
