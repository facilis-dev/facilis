import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { facilisConfigSchema } from "@facilis.dev/core";
import type { Plugin } from "vite";

import { PRERENDER_PLUGIN_NAME, prerender, type PrerenderOptions } from "./prerender.ts";
import { PRERENDER_ENGINE_PLUGIN_NAME } from "./prerender-engine.ts";

/** The declaration gate is the first plugin of the entry's array. */
function gateOf(options: PrerenderOptions = {}): Plugin {
  const plugins = prerender(options);
  const gate = plugins[0];
  if (gate === undefined) throw new Error("prerender() returned no gate plugin");
  return gate;
}

type HookFn = (this: unknown, ...args: unknown[]) => unknown;

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function staticProject(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "facilis-prerender-"));
  tempRoots.push(root);
  for (const [path, source] of Object.entries(files)) {
    const full = join(root, path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, source);
  }
  return root;
}

/** Run configResolved + buildStart the way Vite does; this.error aborts the build. */
function runBuild(plugin: Plugin, root: string): string[] {
  (plugin.configResolved as HookFn).call({}, { root });
  const errors: string[] = [];
  const context = {
    error: (message: string) => {
      errors.push(message);
      throw new Error(message);
    },
  };
  try {
    (plugin.buildStart as HookFn).call(context);
  } catch {
    // this.error throwing is the failure contract; the message is already captured.
  }
  return errors;
}

const VITE_CONFIG = (routes: string[]): string =>
  'import { prerender } from "@facilis.dev/nitro/prerender";\n' +
  "export default { plugins: [prerender({ routes: " +
  JSON.stringify(routes) +
  " })] };\n";

const APP =
  'import { Route, Routes } from "react-router-dom";\n' +
  'import { HomePage } from "./pages/home.tsx";\n' +
  'export function App() { return <Routes><Route path="/" element={<HomePage />} /></Routes>; }\n';

const HOME_PAGE = "export function HomePage() { return <h1>Home</h1>; }\n";

describe("prerender() static-template entry", () => {
  it("is a build-only framework plugin array (gate + engine + serving)", () => {
    const plugins = prerender({ routes: ["/"] });
    expect(plugins.map((plugin) => plugin.name)).toEqual([
      PRERENDER_PLUGIN_NAME,
      PRERENDER_ENGINE_PLUGIN_NAME,
      "facilis:prerender-serving",
    ]);
    expect(plugins[0]?.apply).toBe("build");
    expect(plugins[1]?.apply).toBe("build");
  });

  it("accepts no options (prerendering off)", () => {
    expect(gateOf().name).toBe(PRERENDER_PLUGIN_NAME);
  });

  it.each([
    [{ routes: ["about"] }, "must start with"],
    [{ routes: ["/users/:id"] }, "param-free"],
    [{ routes: ["/about/"] }, "must not end with"],
    [{ routes: ["/a", "/a"] }, "duplicate"],
    [{ origin: "ftp://example.com" }, "http or https"],
    [{ routes: [], crawl: true }, "crawl"],
  ])("rejects invalid options %j", (options, message) => {
    expect(() => prerender(options as PrerenderOptions)).toThrow(message);
  });

  // The entry must not import core runtime code (D-202/D-168), so its schema restates the
  // core section; this table proves the two accept and reject exactly the same declarations.
  const PARITY_CASES: readonly unknown[] = [
    { routes: [] },
    { routes: ["/", "/about"] },
    { routes: ["/"], origin: "https://example.com" },
    { routes: ["/"], origin: "http://localhost:5173" },
    { routes: ["about"] },
    { routes: ["/users/:id"] },
    { routes: ["/users/{id}"] },
    { routes: ["/files/*"] },
    { routes: ["/about/"] },
    { routes: ["/a", "/a"] },
    { routes: ["/a?b=1"] },
    { routes: ["/a#frag"] },
    { routes: ["/a b"] },
    { routes: ["/a\\b"] },
    { routes: ["/a//b"] },
    { routes: [""] },
    { origin: "not a url" },
    { origin: "ftp://example.com" },
    { origin: "https://example.com/path" },
    { origin: "https://example.com/?q=1" },
    { origin: "https://user:pass@example.com" },
    { origin: "" },
    { routes: [], crawl: true },
  ];

  it.each(PARITY_CASES)("mirrors the core prerender schema for %j", (value) => {
    const core = facilisConfigSchema.safeParse({
      auth: { defaultRole: "user", roles: { user: [] } },
      prerender: value,
    });
    let entryAccepted = true;
    try {
      prerender(value as PrerenderOptions);
    } catch {
      entryAccepted = false;
    }
    expect(entryAccepted).toBe(core.success);
  });

  it("fails the build for a declared route with no page (fail closed)", async () => {
    const root = await staticProject({
      "vite.config.ts": VITE_CONFIG(["/missing"]),
      "src/app.tsx": APP,
      "src/pages/home.tsx": HOME_PAGE,
    });
    const errors = runBuild(gateOf({ routes: ["/missing"] }), root);
    expect(errors).toEqual([
      '[facilis] prerender-ineligible: route "/missing" is not prerender-eligible (unknown-security)',
    ]);
  });

  it("is silent for a declared eligible static page", async () => {
    const root = await staticProject({
      "vite.config.ts": VITE_CONFIG(["/"]),
      "src/app.tsx": APP,
      "src/pages/home.tsx": HOME_PAGE,
    });
    expect(runBuild(gateOf({ routes: ["/"] }), root)).toEqual([]);
  });

  it("is silent when the allowlist is empty", async () => {
    const root = await staticProject({
      "vite.config.ts": VITE_CONFIG([]),
      "src/app.tsx": APP,
      "src/pages/home.tsx": HOME_PAGE,
    });
    expect(runBuild(gateOf({ routes: [] }), root)).toEqual([]);
  });
});
