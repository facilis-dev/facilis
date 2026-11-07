import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { facilis, type FacilisVitePlugin } from "./vite.ts";
import { RESOLVED_OPENAPI_META_ID, VIRTUAL_OPENAPI_META_ID } from "./virtual-ids.ts";

const projectRoot = fileURLToPath(new URL("../test-fixtures/project", import.meta.url));
const absentRoot = fileURLToPath(new URL("../test-fixtures/absent", import.meta.url));

type HookFn = (this: unknown, ...args: unknown[]) => unknown;
type Listener = (event: string, file: string) => void;

const CONFIG_SOURCE = `import { defineConfig } from "@facilis/core";

export default defineConfig({
  db: { mode: "pglite", migrationsDir: "db/migrations", tenantColumns: ["tenantId"], ownerColumns: ["ownerId"] },
  i18n: { defaultLocale: "en", locales: ["en"] },
  auth: {
    permissions: ["todos:read"],
    roles: { user: ["todos:read"] },
    defaultRole: "user",
    sessionDurationMs: 60_480_000,
  },
});
`;

const ROUTE_SOURCE = `import { defineAuthorizedHandler } from "@facilis/core";
import { tables } from "../lib/route-config";

export default defineAuthorizedHandler(
  {
    permission: "todos:read",
    dbTables: tables,
    description: "Imported table list.",
  },
  async () => ({ ok: true }),
);
`;

const INVALID_CONFIG_SOURCE = 'export default { auth: { defaultRole: "user" } };\n';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function facilisPlugin(): FacilisVitePlugin {
  return facilis()[0];
}

function resolvedPlugin(root = projectRoot): FacilisVitePlugin {
  const plugin = facilisPlugin();
  const configResolved = plugin.configResolved as HookFn;
  configResolved.call({}, { root });
  return plugin;
}

function warnSink(): { warn: (message: string) => void; warnings: string[] } {
  const warnings: string[] = [];
  return { warnings, warn: (message) => warnings.push(message) };
}

interface FakeServer {
  readonly invalidated: string[];
  readonly emit: (event: string, file: string) => void;
}

/** Minimal ViteDevServer surface the plugin touches (watcher, module graphs). */
function fakeServer(): FakeServer & Record<string, unknown> {
  const listeners: Listener[] = [];
  const invalidated: string[] = [];
  const moduleGraph = {
    getModuleById: (id: string) => ({ id }),
    invalidateModule: (module: unknown) => invalidated.push((module as { id: string }).id),
  };
  return {
    invalidated,
    emit: (event, file) => {
      for (const listener of listeners) listener(event, file);
    },
    watcher: {
      on: (_event: string, listener: Listener) => listeners.push(listener),
      add: () => {},
    },
    environments: {},
    moduleGraph,
  };
}

async function createProject(configSource = CONFIG_SOURCE): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "facilis-nitro-"));
  tempRoots.push(root);
  await mkdir(join(root, "server", "routes"), { recursive: true });
  await mkdir(join(root, "server", "lib"), { recursive: true });
  await writeFile(join(root, "facilis.config.ts"), configSource);
  await writeFile(
    join(root, "server", "lib", "route-config.ts"),
    'export const tables = ["todos"];\n',
  );
  await writeFile(join(root, "server", "routes", "dynamic.get.ts"), ROUTE_SOURCE);
  return root;
}

describe("facilis Vite plugin", () => {
  it("mounts Nitro itself: the framework plugin first, then Nitro's plugins", () => {
    const plugins = facilis();
    const plugin = plugins[0];

    expect(plugin.name).toBe("facilis");
    expect(plugin.enforce).toBe("pre");
    expect(plugin.nitro.name).toBe("facilis");
    expect(plugin.nitro.setup).toBeTypeOf("function");
    // No nitro/vite import is left to the project (D-034): facilis() brings the plugins.
    expect(plugins.length).toBeGreaterThan(1);
    expect(plugins.some((entry) => entry.name === "nitro:init")).toBe(true);
  });

  it("delivers the project Nitro options through the Vite user-config nitro key", async () => {
    const config = facilisPlugin().config as HookFn;

    const result = await config.call({}, { root: projectRoot }, { command: "serve" });

    expect(result).toEqual({
      nitro: {
        serverDir: "./server",
        experimental: { openAPI: true },
        devServer: { runner: "self" },
      },
    });
  });

  it("falls back to the Facilis Nitro defaults when the project has no config file", async () => {
    const config = facilisPlugin().config as HookFn;

    const result = await config.call({}, { root: absentRoot }, { command: "serve" });

    expect(result).toEqual({ nitro: { serverDir: "./server", experimental: { openAPI: true } } });
  });

  it("resolves the metadata virtual module to a null-prefixed id", () => {
    const plugin = facilisPlugin();
    const resolveId = plugin.resolveId as HookFn;
    expect(resolveId.call({}, VIRTUAL_OPENAPI_META_ID, undefined)).toBe(RESOLVED_OPENAPI_META_ID);
    expect(resolveId.call({}, "some-other-module", undefined)).toBeNull();
  });

  it("loads the analyzer's route metadata as the virtual module", async () => {
    const plugin = resolvedPlugin();
    const load = plugin.load as HookFn;
    const sink = warnSink();
    const code = (await load.call(sink, RESOLVED_OPENAPI_META_ID)) as string;

    expect(code.startsWith("export default ")).toBe(true);
    expect(code).toContain('"/api/todos"');
    expect(code).toContain('"/health"');
    // Unwrapped route files are listed (integrity view) with their warnings attached.
    expect(code).toContain("route-wrapper");
    // Route-level diagnostics live on the route; nothing is left for the file-level sink.
    expect(sink.warnings).toEqual([]);
  });

  it("ignores non-virtual module ids", async () => {
    const plugin = resolvedPlugin();
    const load = plugin.load as HookFn;
    expect(await load.call(warnSink(), "/abs/some/file.ts")).toBeNull();
  });

  it("returns an empty map when the project root does not exist", async () => {
    const plugin = resolvedPlugin(absentRoot);
    const load = plugin.load as HookFn;
    expect(await load.call(warnSink(), RESOLVED_OPENAPI_META_ID)).toBe("export default {};");
  });

  it("warns instead of throwing when the project config cannot be analyzed", async () => {
    const plugin = resolvedPlugin(await createProject(INVALID_CONFIG_SOURCE));
    const warnings: string[] = [];
    const buildStart = plugin.buildStart as HookFn;

    await buildStart.call({ warn: (message: string) => warnings.push(message) });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("defineConfig");
  });

  it("re-analyzes when a route config's imported const changes, not only route files", async () => {
    const root = await createProject();
    const plugin = resolvedPlugin(root);
    const load = plugin.load as HookFn;
    const server = fakeServer();
    const handleHotUpdate = plugin.handleHotUpdate as HookFn;

    const before = (await load.call(warnSink(), RESOLVED_OPENAPI_META_ID)) as string;
    expect(before).toContain('"todos"');

    // The analyzer reads ./lib/route-config.ts, so editing it must drop the cached analysis.
    const libFile = join(root, "server", "lib", "route-config.ts");
    await writeFile(libFile, 'export const tables = ["todos", "audit"];\n');
    await handleHotUpdate.call({}, { file: libFile, server });

    const after = (await load.call(warnSink(), RESOLVED_OPENAPI_META_ID)) as string;
    expect(after).toContain('"audit"');
    expect(server.invalidated).toContain(RESOLVED_OPENAPI_META_ID);
  });

  it("does not re-analyze for a file outside the project root", async () => {
    const root = await createProject();
    const outsideRoot = await createProject();
    const plugin = resolvedPlugin(root);
    const load = plugin.load as HookFn;
    const server = fakeServer();
    const handleHotUpdate = plugin.handleHotUpdate as HookFn;

    await load.call(warnSink(), RESOLVED_OPENAPI_META_ID);
    await writeFile(
      join(root, "server", "lib", "route-config.ts"),
      'export const tables = ["todos", "audit"];\n',
    );
    await handleHotUpdate.call(
      {},
      { file: join(outsideRoot, "server", "lib", "route-config.ts"), server },
    );

    const cached = (await load.call(warnSink(), RESOLVED_OPENAPI_META_ID)) as string;
    expect(cached).not.toContain('"audit"');
    expect(server.invalidated).toEqual([]);
  });

  it("invalidates when a new route file is added", async () => {
    const root = await createProject();
    const plugin = resolvedPlugin(root);
    const load = plugin.load as HookFn;
    const server = fakeServer();
    const configureServer = plugin.configureServer as HookFn;
    configureServer.call({}, server);

    const before = (await load.call(warnSink(), RESOLVED_OPENAPI_META_ID)) as string;
    expect(before).not.toContain('"/health"');

    const routeFile = join(root, "server", "routes", "health.get.ts");
    await writeFile(
      routeFile,
      `import { defineAuthorizedHandler } from "@facilis/core";

export default defineAuthorizedHandler(
  { permission: [], dbTables: [], description: "Health probe." },
  async () => ({ ok: true }),
);
`,
    );
    server.emit("add", routeFile);

    const after = (await load.call(warnSink(), RESOLVED_OPENAPI_META_ID)) as string;
    expect(after).toContain('"/health"');
    expect(server.invalidated).toContain(RESOLVED_OPENAPI_META_ID);
  });
});
