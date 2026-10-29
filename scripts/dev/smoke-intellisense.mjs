// IntelliSense acceptance check for the Facilis template (user-reported TS2307).
//
// The IDE feeds installed node_modules **/*.d.ts to Monaco's TypeScript worker as extra
// libs (controller.loadDependencyTypes). The user-visible symptom of a missing @types
// package is a red squiggle on `import ... from "react"` and a Problems count stuck above
// zero. This asserts on the source of that projection: the SAME language service the
// editor uses is asked for the project's semantic diagnostics, and a module-resolution
// error fails the run. A worker that cannot be reached also fails — treating "no answer"
// as a pass would hide exactly the regression this check exists for.
//
// Why not count Monaco markers: markers are a push copy of these diagnostics and race the
// worker rebuild that happens when the extra libs finish loading.
//
// This runs right after the framework probe and before the write checks: it only reads
// (open + query) and the template's dependencies are installed by then, so the check
// costs a few hundred ms on a healthy project instead of delaying the write path.

const POLL_MS = 500;
const TIMEOUT_MS = Number(process.env.FACILIS_INTELLISENSE_TIMEOUT_MS || 30000);
const MODULE_NOT_FOUND = 2307;
const FILES = ["src/App.tsx", "src/main.tsx"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs in the page. window.__ide is the IdeController (dev-only handle); its `monaco`
// property is the loaded monaco-editor module once the editor has booted, and
// activeFolder is the controller getter for the folder the project was opened in.
function diagnosticsExpression() {
  return `(async () => {
    const c = window.__ide;
    const folder = c && c.activeFolder;
    const state = {
      ide: typeof c,
      monaco: Boolean(c && c.monaco),
      folder: folder ? folder.rootPath : null,
      folders: c && c.getSnapshot ? c.getSnapshot().workspaceFolders.length : -1,
    };
    if (!c || !c.monaco || !folder) return { ready: false, reason: JSON.stringify(state) };
    const monaco = c.monaco;
    const files = ${JSON.stringify(FILES)};
    const results = [];
    try {
      const getWorker = await monaco.languages.typescript.getTypeScriptWorker();
      for (const relative of files) {
        const absolute = folder.rootPath + "/" + relative;
        const uri = monaco.Uri.file(absolute);
        const model = monaco.editor.getModel(uri);
        if (!model) { results.push({ file: relative, diagnostics: null }); continue; }
        const client = await getWorker(uri);
        const diagnostics = await client.getSemanticDiagnostics(uri.toString());
        results.push({
          file: relative,
          diagnostics: diagnostics.map((d) => ({
            code: typeof d.code === "number" ? d.code : Number(d.code),
            message: String(d.messageText || ""),
          })),
        });
      }
      return { ready: true, files: results };
    } catch (error) {
      return { ready: false, reason: String(error && error.message ? error.message : error) };
    }
  })()`;
}

function moduleErrors(state) {
  if (!state || !state.ready) return [];
  return state.files.flatMap((entry) =>
    (entry.diagnostics || [])
      .filter((diagnostic) => diagnostic.code === MODULE_NOT_FOUND)
      .map((diagnostic) => entry.file + ": TS" + diagnostic.code + " " + diagnostic.message),
  );
}

// Open the probe files first: the language service only knows models that exist, and the
// template opens App.tsx while main.tsx may still be unopened.
async function openProbeFiles(page) {
  await page.evaluate(`(async () => {
    const c = window.__ide;
    const folder = c && c.activeFolder;
    if (!folder) return false;
    for (const relative of ${JSON.stringify(FILES)}) await c.openFile(folder.rootPath + "/" + relative);
    return true;
  })()`);
}

export async function runIntellisenseChecks({ page, check }) {
  const checks = [];
  const record = (ok, label, detail) => {
    const entry = { label, ok: Boolean(ok), detail: detail || "" };
    checks.push(entry);
    try {
      check(entry.ok, label, entry.detail);
    } catch {
      // The reporter is not part of the verdict.
    }
  };

  await openProbeFiles(page).catch(() => false);

  const until = Date.now() + TIMEOUT_MS;
  let state = { ready: false, reason: "not queried" };
  for (;;) {
    state = await page.evaluate(diagnosticsExpression()).catch((error) => ({
      ready: false,
      reason: String(error && error.message ? error.message : error),
    }));
    const errors = moduleErrors(state);
    if (state.ready && errors.length === 0) break;
    if (Date.now() >= until) break;
    await sleep(POLL_MS);
  }

  const errors = moduleErrors(state);
  const queried = Boolean(state.ready && state.files.every((entry) => entry.diagnostics !== null));
  record(
    queried,
    "editor TypeScript service answered for the template files",
    queried ? "App.tsx and main.tsx diagnostics requested" : String(state.reason || "no answer"),
  );
  record(
    queried && errors.length === 0,
    "editor resolves the template imports (no TS2307)",
    errors.length > 0 ? errors.slice(0, 3).join(" | ") : "no module-resolution errors",
  );

  return { checks, diagnostics: state };
}
