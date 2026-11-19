// The IDE-owned additions to examples/todo-app (D-062).
//
// The generated project is the example. Only these files are not, and each is either an
// IDE-only file or a small, anchored edit the VM needs:
// - server/routes/api/ping.get.ts: a public liveness route the write smoke edits to prove
//   a server-route change reloads the in-VM handler (A8); the example has no such route;
// - three anchored edits to example sources: the HMR hint the write smoke edits, the
//   footer style for it, and the VM's in-process Nitro runner plus the "main" release ref.
// Each edit THROWS if its anchor disappears, so an example refactor fails the IDE test
// suite instead of silently generating a DIFFERENT app.
//
// The framework probe itself is NOT in the generated project: the smoke drives the
// endpoints from the IDE page (scripts/dev/smoke-facilis.mjs), so a user's starter has no
// test instrumentation and never auto-registers a probe user.

import { exampleProjectFiles } from "./example-template";
import { localPackagesEnabled } from "./local-packages";

/** The exact element the write smoke test replaces to prove client HMR. */
export const HMR_HINT = '<p className="muted">Edit src/app.tsx and save to test HMR.</p>';

/** The liveness route the write smoke edits (A8 part 3). */
export const PROBE_PING_ROUTE = `import { defineAuthorizedHandler } from "@facilis.dev/core";

// Public liveness probe the IDE smoke test edits to prove a server-route change reloads
// the in-VM handler (A8). It is an IDE addition to the example app (D-062).
export default defineAuthorizedHandler(
  {
    permission: [],
    dbTables: [],
    description: "Framework liveness probe.",
  },
  async () => ({ ok: true }),
);
`;

function exampleFile(files: Record<string, string>, path: string): string {
  const source = files[path];
  if (source === undefined) throw new Error("template: examples/todo-app has no " + path);
  return source;
}

function replaceOnce(source: string, needle: string, next: string, what: string): string {
  if (!source.includes(needle)) {
    throw new Error("template: " + what + " anchor missing in examples/todo-app");
  }
  return source.replace(needle, next);
}

function replaceOnceIn(
  source: string,
  needle: string,
  next: string,
  what: string,
  exampleDir: string,
): string {
  if (!source.includes(needle)) {
    throw new Error("template: " + what + " anchor missing in " + exampleDir);
  }
  return source.replace(needle, next);
}

/** Append the HMR hint the write smoke test replaces, after the app's Toaster. */
export function injectHmrHint(appSource: string): string {
  return replaceOnce(
    appSource,
    "      <Toaster />",
    "      <Toaster />\n      " + HMR_HINT,
    "<Toaster />",
  );
}

// Plain values, not the old v1 kit tokens: template v2 ships Tailwind CSS v4 and a
// copy-in component kit, so the generated stylesheet defines no --space-* / --color-*
// custom properties for this rule to reference. Only the class name and the
// HMR_HINT string are load-bearing (scripts/dev/smoke-write.mjs replaces that exact
// string), so the declarations can be plain CSS.
const HINT_STYLE = `
/* IDE smoke hint (D-062): the element the write test replaces. */
.muted {
  margin: 0;
  padding: 1rem 2rem;
  color: #5f6b7a;
  font-size: 0.875rem;
  opacity: 0.6;
}
`;

function appendHintStyle(stylesSource: string): string {
  return stylesSource.replace(/\s*$/, "\n") + HINT_STYLE;
}

const VM_NITRO_RUNNER = `  // Nitro options are project config too (D-034). The default node-worker dev runner
  // cannot start inside the WebContainer: it needs worker_threads and resolves its
  // entry through import.meta.resolve, which the VM runtime does not provide as a
  // file URL. The in-process runner keeps init inside the Vite dev-server process;
  // this is a VM environment constraint, not a Facilis default.
  nitro: { devServer: { runner: "self" } },
`;

/**
 * Point the project at "main" and give Nitro the runner the VM can execute.
 *
 * Shared by every full-stack template: the anchors are the same shape in any
 * `facilis.config.ts` (`release: { ref: "origin/main" }` and the closing `});`), and the
 * error message names the example so a refactor fails loudly instead of generating a
 * different app.
 */
export function addVmNitro(configSource: string, exampleDir = "examples/todo-app"): string {
  const config = replaceOnceIn(
    configSource,
    'release: { ref: "origin/main" }',
    'release: { ref: "main" }',
    "release ref",
    exampleDir,
  );
  if (!/\n\}\);\s*$/.test(config)) {
    throw new Error("template: facilis.config.ts tail anchor missing in " + exampleDir);
  }
  return config.replace(/\n\}\);\s*$/, "\n" + VM_NITRO_RUNNER + "});\n");
}

/**
 * Keep Vite from resolving a symlinked file: dep to its real path (issue #41, D-196).
 *
 * The dev local path installs the framework packages as file: directory deps. npm links
 * them into node_modules, and Vite's default realpath resolution then serves a package file
 * by its real path under /vendor/facilis/ — a root-relative URL that escapes the preview's
 * /preview/<port>/ scope and 404s at the IDE origin. preserveSymlinks keeps the import on its
 * node_modules path, so Vite optimizes and serves it under the preview base like a registry
 * package. Only the dev local path needs it; a release build installs real registry dirs.
 */
export function injectPreserveSymlinks(viteSource: string): string {
  return replaceOnce(
    viteSource,
    "  resolve: {\n    alias:",
    "  resolve: {\n    preserveSymlinks: true,\n    alias:",
    "vite.config.ts resolve block",
  );
}

/** Overlay applied after the example files when the template is assembled. */
export function templateOverrides(): Record<string, string> {
  const example = exampleProjectFiles();
  const overrides: Record<string, string> = {
    "server/routes/api/ping.get.ts": PROBE_PING_ROUTE,
    "src/app.tsx": injectHmrHint(exampleFile(example, "src/app.tsx")),
    "src/styles.css": appendHintStyle(exampleFile(example, "src/styles.css")),
    "facilis.config.ts": addVmNitro(exampleFile(example, "facilis.config.ts")),
  };
  if (localPackagesEnabled) {
    overrides["vite.config.ts"] = injectPreserveSymlinks(exampleFile(example, "vite.config.ts"));
  }
  return overrides;
}
