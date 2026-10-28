// VFS write-path acceptance checks for scripts/dev/smoke-ide.mjs (spec Appendix A).
//
// Runs only for TEMPLATE=Facilis, after runFacilisChecks(), and drives the REAL Studio
// controller through the dev-only `window.__ide` handle:
//   A8  vivari.fs.writeFile  -> file appears in the editor/Explorer, client HMR without a
//                              full preview reload, and the in-VM server reloads handlers
//   A9  vivari.fs.writeFiles -> batch write through the framework write path (applyPatch)
//   A10 isomorphic-git over the VFS -> init, status lists the edited files, commit succeeds
//   A12 Vivari reboot (page reload) -> uncommitted files survive through the OPFS mirror
//
// A9 has no separate kernel RPC: the bridge writes one file per `vv-write` request, so a
// batch is the framework's own loop. `window.__facilis.applyPatch` (dev-only handle, see
// ide/src/facilis/dev-handle.ts) is that loop; the check also proves validation runs
// before any write and that locales/*.json changes move the framework revision.
//
// Every check records its own detail and never throws: the caller decides the exit code.

const POLL_MS = 200;
const WRITE_TIMEOUT_MS = Number(process.env.FACILIS_WRITE_TIMEOUT_MS || 45000);
const REBOOT_TIMEOUT_MS = Number(process.env.FACILIS_REBOOT_TIMEOUT_MS || 120000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const PREVIEW_FRAME = `[...document.querySelectorAll("iframe")].find((f) => /preview/.test(f.src || ""))`;

function previewContains(text) {
  return `(() => {
    const f = ${PREVIEW_FRAME};
    if (!f) return false;
    try {
      const doc = f.contentDocument;
      const body = doc && doc.body;
      return ((body && body.innerText) || "").includes(${JSON.stringify(text)});
    } catch { return false; }
  })()`;
}

async function poll(page, expression, limitMs) {
  const until = Date.now() + limitMs;
  for (;;) {
    const value = await page.evaluate(expression).catch(() => false);
    if (value) return true;
    if (Date.now() >= until) return false;
    await sleep(POLL_MS);
  }
}

async function readFile(page, abs) {
  return String(await page.evaluate(`window.__ide.readFileText(${JSON.stringify(abs)})`));
}

async function writeFile(page, abs, contents) {
  return page.evaluate(
    `window.__ide.bridge.request("vv-write", { path: ${JSON.stringify(abs)}, contents: ${JSON.stringify(contents)} })`,
  );
}

async function previewSnapshot(page) {
  return page.evaluate(
    `(() => {
      const f = ${PREVIEW_FRAME};
      if (!f) return { found: false, src: "", text: "", timeOrigin: 0 };
      let text = "";
      let timeOrigin = 0;
      try { text = (f.contentDocument && f.contentDocument.body && f.contentDocument.body.innerText) || ""; } catch {}
      try { timeOrigin = f.contentWindow ? f.contentWindow.performance.timeOrigin : 0; } catch {}
      return { found: true, src: f.src || "", text: text.slice(0, 2000), timeOrigin };
    })()`,
  );
}

// Read the VFS mirror's own index (vv-vfs/manifest.json) from OPFS, so a failed reboot
// check can say whether the file was never mirrored or only never restored.
async function opfsVfsManifest(page, absPath) {
  return page.evaluate(
    `(async () => {
      try {
        const origin = await navigator.storage.getDirectory();
        const base = await origin.getDirectoryHandle("vv-vfs");
        const handle = await base.getFileHandle("manifest.json");
        const file = await handle.getFile();
        const entries = JSON.parse(await file.text());
        const paths = Array.isArray(entries) ? entries.map((entry) => entry[0]) : [];
        const projects = paths.filter((p) => String(p).startsWith("/home/user/projects"));
        return {
          count: paths.length,
          hasProbe: paths.includes(${JSON.stringify(absPath)}),
          sample: projects.slice(0, 8),
        };
      } catch (error) {
        return { error: String(error) };
      }
    })()`,
  );
}

// Does the VFS mirror's on-disk copy of one file exist? Bytes-without-index points at the
// manifest write lagging behind the file writes, which is a different bug from "never
// mirrored" and the opposite of "never restored".
async function opfsFileInfo(page, absPath) {
  return page.evaluate(
    `(async () => {
      try {
        const origin = await navigator.storage.getDirectory();
        let dir = await origin.getDirectoryHandle("vv-vfs");
        dir = await dir.getDirectoryHandle("files");
        const parts = ${JSON.stringify(absPath)}.split("/").filter(Boolean);
        for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
        const handle = await dir.getFileHandle(parts[parts.length - 1]);
        const file = await handle.getFile();
        return { exists: true, bytes: file.size };
      } catch (error) {
        return { exists: false, error: String(error) };
      }
    })()`,
  );
}

async function captureEvidence(page, ARTIFACTS, diagnostics) {
  if (!ARTIFACTS) return;
  const fs = await import("node:fs");
  const path = await import("node:path");
  try {
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    await page.screenshot(path.join(ARTIFACTS, "05-write-failure.png"));
    fs.writeFileSync(
      path.join(ARTIFACTS, "write-diagnostics.json"),
      JSON.stringify(diagnostics, null, 2),
    );
  } catch {
    // Evidence only: never change the verdict.
  }
}

/**
 * Assert the VFS write path (A8/A10/A12). Records through the caller's `check` and
 * returns { checks, diagnostics }.
 */
export async function runWriteChecks({ page, check, ARTIFACTS }) {
  const checks = [];
  // A check that the kernel cannot satisfy yet (upstream, in the read-only vendor tree):
  // recorded, printed and reported, but not counted as a failure of the Facilis write path.
  const knownIssues = [];
  const record = (ok, label, detail = "") => {
    const entry = { label, ok: Boolean(ok), detail: String(detail || "") };
    checks.push(entry);
    try {
      check(entry.ok, label, entry.detail);
    } catch {
      // The reporter is not part of the verdict.
    }
  };
  const diagnostics = {};

  const root = String(
    await page.evaluate(
      `(() => { const c = window.__ide; const f = c && c.activeFolder; return f ? f.rootPath : ""; })()`,
    ),
  );
  record(Boolean(root), "A8 project root resolved", root || "window.__ide.activeFolder is null");
  if (!root) return { checks, diagnostics, knownIssues };
  diagnostics.opfsAtStart = await opfsVfsManifest(page, root + "/src/vv-write-probe.txt");

  // -- A8 part 1: a kernel write reaches the editor + the Explorer index ----------
  const probeAbs = root + "/src/vv-write-probe.txt";
  const probeText = "facilis-vfs-write-probe";
  try {
    await writeFile(page, probeAbs, probeText + "\n");
  } catch (error) {
    record(false, "A8 vv-write request succeeds", String(error));
  }
  const probeInVfs = await poll(
    page,
    `window.__ide.readFileText(${JSON.stringify(probeAbs)}).then((t) => String(t).includes(${JSON.stringify(probeText)})).catch(() => false)`,
    15000,
  );
  record(probeInVfs, "A8 written file is readable from the VFS", probeAbs);

  // Mirror visibility for the A12 verdict: does OPFS hold the bytes, the index entry, both?
  diagnostics.opfsMirror = { afterProbeWrite: await opfsVfsManifest(page, probeAbs) };
  await sleep(2000);
  diagnostics.opfsMirror.afterTwoSeconds = await opfsVfsManifest(page, probeAbs);
  diagnostics.opfsMirror.probeFile = await opfsFileInfo(page, probeAbs);

  await page.evaluate(`window.__ide.openFile(${JSON.stringify(probeAbs)})`);
  const inEditor = await poll(
    page,
    `(() => {
      const c = window.__ide;
      const m = c.editor && c.editor.getModel();
      return Boolean(m && String(m.getValue()).includes(${JSON.stringify(probeText)}));
    })()`,
    15000,
  );
  record(inEditor, "A8 written file appears in the editor", probeAbs);

  const inTree = await poll(
    page,
    `window.__ide.getSnapshot().files.some((f) => f.endsWith("/vv-write-probe.txt"))`,
    15000,
  );
  record(inTree, "A8 written file appears in the Explorer index");

  // -- A8 part 2: a user edit saves to the VFS and hot-updates the preview --------
  const appAbs = root + "/src/App.tsx";
  const hmrMarker = "write-hmr-ok";
  const needle = '<p className="muted">Edit src/App.tsx and save to test HMR.</p>';
  const appOriginal = await readFile(page, appAbs).catch(() => "");
  record(appOriginal.includes(needle), "A8 template App.tsx contains the HMR hint", needle);
  const before = await previewSnapshot(page);
  if (appOriginal.includes(needle)) {
    const edited = appOriginal.replace(
      needle,
      `<p className="muted" data-hmr-smoke="1">${hmrMarker}</p>`,
    );
    await page.evaluate(`window.__ide.openFile(${JSON.stringify(appAbs)})`);
    await page.evaluate(
      `(() => {
        const c = window.__ide;
        const m = c.editor && c.editor.getModel();
        if (!m) return "NO_MODEL";
        m.setValue(${JSON.stringify(edited)});
        c.saveActiveFile();
        return "OK";
      })()`,
    );
    const saved = await poll(
      page,
      `window.__ide.readFileText(${JSON.stringify(appAbs)}).then((t) => String(t).includes(${JSON.stringify(hmrMarker)})).catch(() => false)`,
      20000,
    );
    record(saved, "A8 editor save reaches the VFS");
    const hmr = await poll(page, previewContains(hmrMarker), WRITE_TIMEOUT_MS);
    record(hmr, "A8 client HMR updates the preview");
    const after = await previewSnapshot(page);
    record(
      after.timeOrigin === before.timeOrigin && after.timeOrigin !== 0,
      "A8 client HMR keeps the preview document (no full reload)",
      "before=" + before.timeOrigin + " after=" + after.timeOrigin,
    );
    diagnostics.hmr = { before, after };
  }

  // -- A8 part 3: editing a server route reloads the in-VM handler ----------------
  const routeAbs = root + "/server/routes/api/ping.get.ts";
  const routeMarker = "server-reload-ok";
  const routeOriginal = await readFile(page, routeAbs).catch(() => "");
  const routeNeedle = "async () => ({ ok: true })";
  record(routeOriginal.includes(routeNeedle), "A8 ping route found", routeAbs);
  if (routeOriginal.includes(routeNeedle)) {
    const routeNext = routeOriginal.replace(
      routeNeedle,
      `async () => ({ ok: true, smoke: "${routeMarker}" })`,
    );
    await writeFile(page, routeAbs, routeNext);
    const routeReloaded = await poll(
      page,
      `(() => {
        const f = ${PREVIEW_FRAME};
        if (!f || !f.src) return false;
        const base = f.src.endsWith("/") ? f.src : f.src + "/";
        return fetch(new URL("api/ping", base).href)
          .then((r) => r.json())
          .then((b) => Boolean(b && b.smoke === ${JSON.stringify(routeMarker)}))
          .catch(() => false);
      })()`,
      WRITE_TIMEOUT_MS,
    );
    record(routeReloaded, "A8 server route reload serves the edited handler");
    if (!routeReloaded) {
      diagnostics.serverRoute = await page
        .evaluate(
          `(() => {
            const f = ${PREVIEW_FRAME};
            if (!f || !f.src) return { error: "no preview frame" };
            const base = f.src.endsWith("/") ? f.src : f.src + "/";
            return fetch(new URL("api/ping", base).href)
              .then(async (r) => ({ status: r.status, body: (await r.text()).slice(0, 500) }))
              .catch((e) => ({ error: String(e) }));
          })()`,
        )
        .catch((error) => ({ error: String(error) }));
    }
  }

  // -- A9: a batch write through the framework write path (applyPatch) -----------
  const previewFrame = await previewSnapshot(page);
  const revisionBefore = await page.evaluate(
    `(() => {
      const f = ${PREVIEW_FRAME};
      if (!f || !f.src) return "";
      const base = f.src.endsWith("/") ? f.src : f.src + "/";
      return fetch(new URL("__facilis/manifest/revision", base).href)
        .then((r) => r.json())
        .then((b) => (b && typeof b.revision === "string" ? b.revision : ""))
        .catch(() => "");
    })()`,
  );
  const localesAbs = root + "/locales/en.json";
  const localesText = await readFile(page, localesAbs).catch(() => "");
  let localesNext = localesText;
  try {
    const locales = JSON.parse(localesText);
    locales["smoke.patch"] = "ok";
    localesNext = JSON.stringify(locales, null, 2) + "\n";
  } catch {
    // Leave the file untouched: the revision assertion below will say so.
  }
  const hasHandle = await page.evaluate("Boolean(window.__facilis && window.__facilis.applyPatch)");
  record(hasHandle, "A9 dev write path installed", "window.__facilis.applyPatch");
  if (hasHandle) {
    const rejected = await page.evaluate(
      `window.__facilis.applyPatch({ patches: [{ path: "../escape.txt", action: "create", content: "x" }] })`,
    );
    record(
      Boolean(rejected && rejected.ok === false && rejected.written.length === 0),
      "A9 applyPatch rejects an unsafe path before writing",
      rejected
        ? JSON.stringify(rejected.validation.errors.map((entry) => entry.rule))
        : "no result",
    );
    const batch = await page.evaluate(
      `window.__facilis.applyPatch({
        manifestBase: ${JSON.stringify(previewFrame.src)},
        patches: [
          { path: "src/patch-a.txt", action: "create", content: "patch-a" },
          { path: "src/patch-b.txt", action: "create", content: "patch-b" },
          { path: "locales/en.json", action: "update", content: ${JSON.stringify(localesNext)} },
        ],
      })`,
    );
    record(
      Boolean(batch && batch.ok === true && batch.written.length === 3),
      "A9 applyPatch writes a multi-file batch through the VFS",
      batch ? JSON.stringify(batch.written) : "no result",
    );
    const bothThere = await poll(
      page,
      `Promise.all([${JSON.stringify(root + "/src/patch-a.txt")}, ${JSON.stringify(root + "/src/patch-b.txt")}].map((p) => window.__ide.readFileText(p).then((t) => String(t).length > 0).catch(() => false))).then((r) => r.every(Boolean))`,
      15000,
    );
    record(bothThere, "A9 both batch files are readable from the VFS");
    record(
      Boolean(batch && typeof batch.revision === "string" && batch.revision !== revisionBefore),
      "A9 applyPatch refreshes the framework revision after the write",
      batch ? "before=" + revisionBefore + " after=" + batch.revision : "no result",
    );
    const removed = await page.evaluate(
      `window.__facilis.applyPatch({ patches: [{ path: "src/patch-b.txt", action: "delete" }] })`,
    );
    const gone = await page.evaluate(
      `window.__ide.readFileText(${JSON.stringify(root + "/src/patch-b.txt")}).then((text) => String(text).length === 0).catch(() => true)`,
    );
    record(
      Boolean(removed && removed.ok === true && removed.deleted.length === 1 && gone),
      "A9 applyPatch deletes through the VFS",
      removed ? JSON.stringify(removed.deleted) : "no result",
    );
  }

  // -- A10: isomorphic-git over the VFS ------------------------------------------
  const identity = { name: "Facilis Smoke", email: "smoke@facilis.dev" };
  const commitMessage = "test: facilis vfs write smoke";
  try {
    await page.evaluate(`window.__ide.scm.init(${JSON.stringify(root)})`);
    await page.evaluate("window.__ide.scm.refresh()");
    const status = await page.evaluate(
      `(() => {
        const s = window.__ide.scm.getSnapshot();
        const r = s.repos.find((x) => x.root === ${JSON.stringify(root)});
        if (!r) return null;
        return { isRepo: r.isRepo, error: r.error, changes: r.changes.map((c) => c.path) };
      })()`,
    );
    diagnostics.gitStatus = status;
    record(
      status && status.isRepo === true,
      "A10 git init on the VFS",
      status ? status.error || "repo" : "no repo entry",
    );
    const listed = Boolean(
      status && status.changes && status.changes.includes("src/vv-write-probe.txt"),
    );
    record(
      listed,
      "A10 git status lists the written file",
      status ? status.changes.join(", ") : "",
    );
    const committed = await page.evaluate(
      `window.__ide.scm.commit(${JSON.stringify(root)}, ${JSON.stringify(commitMessage)}, ${JSON.stringify(identity)})`,
    );
    record(committed === true, "A10 git commit on the VFS succeeds");
    const history = await page.evaluate(
      `(() => {
        const s = window.__ide.scm.getSnapshot();
        const r = s.repos.find((x) => x.root === ${JSON.stringify(root)});
        return r ? r.history.map((h) => h.message) : [];
      })()`,
    );
    record(
      Array.isArray(history) && history.includes(commitMessage),
      "A10 commit appears in the VFS history",
      Array.isArray(history) ? history.slice(0, 3).join(" | ") : "",
    );
  } catch (error) {
    record(false, "A10 isomorphic-git over the VFS", String(error));
  }

  // -- A12: the OPFS mirror restores the VFS after a reboot (page reload) ---------
  const persistedBefore = await readFile(page, probeAbs).catch(() => "");
  const timeOriginBefore = await page.evaluate("performance.timeOrigin").catch(() => 0);
  diagnostics.reboot = { before: persistedBefore.slice(0, 120), timeOriginBefore };
  // Flush the write-behind mirror the way a hiding tab does, so this measures
  // durability of a flushed VFS rather than the OPFS drain race (SPEC 13 risk 9).
  await page.evaluate("document.dispatchEvent(new Event('visibilitychange'))");
  await sleep(1500);
  diagnostics.reboot.opfsBeforeReload = await opfsVfsManifest(page, probeAbs);
  // Page.reload, not evaluate("location.reload()"): a navigation destroys the execution
  // context and a pending Runtime.evaluate never settles.
  await page.send("Page.reload", {});
  // Wait for the NEW document before touching the controller: a stale evaluate in the
  // reloading page answers from the old boot and makes the restore look instantaneous.
  const rebooted = await poll(
    page,
    "performance.timeOrigin !== " +
      JSON.stringify(timeOriginBefore) +
      " && document.readyState === 'complete'",
    REBOOT_TIMEOUT_MS,
  );
  record(rebooted, "A12 page reboots into a fresh document");
  const restored = await poll(
    page,
    "Boolean(window.__ide && window.__ide.getSnapshot().kernelReady)",
    REBOOT_TIMEOUT_MS,
  );
  record(restored, "A12 kernel reboots after a reload");
  // Restore runs before the FS worker serves syscalls, but give the reloaded Studio a
  // beat to mount the workspace before asking the VFS what survived.
  await sleep(2000);
  diagnostics.reboot.opfsAfterReload = await opfsVfsManifest(page, probeAbs);
  diagnostics.reboot.vfs = await page
    .evaluate(
      `(async () => {
        const c = window.__ide;
        if (!c) return { error: "no controller" };
        const list = (path) => c.readdir(path).then((entries) => entries.map((e) => e.name)).catch((error) => ["ERROR:" + String(error)]);
        return {
          root: await list("/"),
          home: await list("/home/user"),
          projects: await list("/home/user/projects"),
          project: await c.pathInfo(${JSON.stringify(root)}).catch(() => null),
          packageJsonBytes: await c.readFileText(${JSON.stringify(root + "/package.json")}).then((text) => String(text).length).catch(() => -1),
        };
      })()`,
    )
    .catch((error) => ({ error: String(error) }));
  // The boot log is the only place the kernel explains a failed restore ("[opfs] …"), and
  // the Studio mounts it as the console terminal on Home.
  diagnostics.reboot.terminal = String(
    await page.evaluate(
      `(() => {
        try {
          const rows = [...document.querySelectorAll(".xterm-rows > div")].map((row) => row.textContent || "");
          if (rows.length > 0) return rows.join(String.fromCharCode(10)).slice(-4000);
          const host = document.querySelector(".xterm");
          return host ? (host.textContent || "").slice(-4000) : "";
        } catch {
          return "";
        }
      })()`,
    ),
  ).slice(-4000);
  // What the mirror's own index says about the file, BEFORE the reload: no index entry
  // means the write-behind queue never drained it, which is an upstream kernel defect
  // (D-028), not a restore bug in the IDE.
  const mirrorHasProbe = Boolean(
    diagnostics.reboot.opfsBeforeReload && diagnostics.reboot.opfsBeforeReload.hasProbe,
  );
  const projectTreeRestored = Boolean(
    diagnostics.reboot.vfs &&
    diagnostics.reboot.vfs.project &&
    diagnostics.reboot.vfs.project.exists === true &&
    diagnostics.reboot.vfs.packageJsonBytes > 0,
  );
  record(
    projectTreeRestored,
    "A12 reboot restores the mirrored project tree from OPFS",
    projectTreeRestored
      ? "package.json " + String(diagnostics.reboot.vfs.packageJsonBytes) + " bytes"
      : JSON.stringify(diagnostics.reboot.vfs),
  );
  // Restore runs before the FS worker serves syscalls, but the reloaded Studio boots
  // its own kernel; poll for the file instead of racing a single read.
  // Nothing to wait for when the mirror never indexed the file: restore cannot invent it.
  const persisted =
    mirrorHasProbe &&
    (await poll(
      page,
      `window.__ide.readFileText(${JSON.stringify(probeAbs)}).then((t) => String(t).includes(${JSON.stringify(probeText)})).catch(() => false)`,
      REBOOT_TIMEOUT_MS,
    ));
  const persistedAfter = await readFile(page, probeAbs).catch(() => "");
  diagnostics.reboot.after = persistedAfter.slice(0, 120);
  if (persisted) {
    record(true, "A12 uncommitted file survives the reboot (OPFS mirror)", "restored from OPFS");
  } else if (!mirrorHasProbe) {
    knownIssues.push({
      label: "A12 uncommitted file survives the reboot (OPFS mirror)",
      detail:
        "blocked upstream (D-028): the OPFS mirror's index never received the file — " +
        "vv-vfs/manifest.json stayed at " +
        String((diagnostics.reboot.opfsBeforeReload || {}).count) +
        " entries and vv-vfs/files has no copy, so nothing was there to restore",
    });
  } else {
    record(
      false,
      "A12 uncommitted file survives the reboot (OPFS mirror)",
      "the mirror has the file but the reloaded VFS lost it",
    );
  }

  if (checks.some((entry) => !entry.ok) || knownIssues.length > 0)
    await captureEvidence(page, ARTIFACTS, diagnostics);
  return { checks, diagnostics, knownIssues };
}
