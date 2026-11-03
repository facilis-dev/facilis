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

/** The exact element the write smoke test replaces to prove client HMR. */
export const HMR_HINT = '<p className="muted">Edit src/app.tsx and save to test HMR.</p>';

/** The liveness route the write smoke edits (A8 part 3). */
export const PROBE_PING_ROUTE = `import { defineAuthorizedHandler } from "@facilis/core";

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

/** Append the HMR hint the write smoke test replaces, after the app's Toaster. */
export function injectHmrHint(appSource: string): string {
  return replaceOnce(
    appSource,
    "      <Toaster />",
    "      <Toaster />\n      " + HMR_HINT,
    "<Toaster />",
  );
}

// Plain values, not the v1 @facilis/ui tokens: template v2 ships Tailwind CSS v4 and a
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

/** Point the project at "main" and give Nitro the runner the VM can execute. */
export function addVmNitro(configSource: string): string {
  const config = replaceOnce(
    configSource,
    'release: { ref: "origin/main" }',
    'release: { ref: "main" }',
    "release ref",
  );
  if (!/\n\}\);\s*$/.test(config)) {
    throw new Error("template: facilis.config.ts tail anchor missing in examples/todo-app");
  }
  return config.replace(/\n\}\);\s*$/, "\n" + VM_NITRO_RUNNER + "});\n");
}

/** Overlay applied after the example files when the template is assembled. */
export function templateOverrides(): Record<string, string> {
  const example = exampleProjectFiles();
  return {
    "server/routes/api/ping.get.ts": PROBE_PING_ROUTE,
    "src/app.tsx": injectHmrHint(exampleFile(example, "src/app.tsx")),
    "src/styles.css": appendHintStyle(exampleFile(example, "src/styles.css")),
    "facilis.config.ts": addVmNitro(exampleFile(example, "facilis.config.ts")),
  };
}
