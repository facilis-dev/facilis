import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Nitro } from "nitro/types";

import { createFacilisNitroModule } from "./module.ts";
import {
  DEV_QUERY_ROUTE,
  DEV_SCHEMA_ROUTE,
  DEV_VIEW_ROUTE,
  NATIVE_OPENAPI_ROUTE,
  SECURITY_SURFACE_ROUTE,
  OPENAPI_FACADE_ROUTE,
  SSO_ROUTE,
  TELEMETRY_TRACES_ROUTE,
  TOKEN_ROUTE,
} from "./constants.ts";
import {
  VIRTUAL_CONFIG_ID,
  VIRTUAL_DB_SCHEMA_ID,
  VIRTUAL_DB_VIEWS_ID,
  VIRTUAL_JOBS_ID,
  VIRTUAL_OPENAPI_META_ID,
  VIRTUAL_WORKFLOWS_ID,
} from "./virtual-ids.ts";

const projectRoot = fileURLToPath(new URL("../test-fixtures/project", import.meta.url));
// The virtual module reports the version committed in the core manifest (D-198), so the
// assertion reads it too instead of pinning a placeholder literal that every bump breaks.
const coreVersion: string = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../core/package.json", import.meta.url)), "utf8"),
).version;

interface MockOptions {
  rootDir: string;
  dev: boolean;
  alias: Record<string, string>;
  virtual: Record<string, string | (() => string | Promise<string>)>;
  handlers: Array<Record<string, unknown>>;
  plugins: string[];
  openAPI?: { route?: string; production?: false | "runtime" | "prerender" };
  experimental: { openAPI?: boolean };
}

interface MockNitro {
  options: MockOptions;
}

function createMockNitro(overrides: Partial<MockOptions> = {}): MockNitro {
  return {
    options: {
      rootDir: `${projectRoot}/`,
      dev: true,
      alias: {},
      virtual: {},
      handlers: [],
      plugins: [],
      experimental: { openAPI: true },
      ...overrides,
    },
  };
}

function setup(mock: MockNitro): void {
  createFacilisNitroModule().setup(mock as unknown as Nitro);
}

async function render(template: unknown): Promise<string> {
  expect(typeof template).toBe("function");
  return await (template as () => Promise<string>)();
}

describe("createFacilisNitroModule", () => {
  it("is a plain nitro module object (no defineNitroModule)", () => {
    const module = createFacilisNitroModule();
    expect(module.name).toBe("facilis");
    expect(module.setup).toBeTypeOf("function");
  });

  it("registers the ~ alias to the project root (server-side SPEC Appendix C)", () => {
    const mock = createMockNitro();
    setup(mock);
    expect(mock.options.alias["~"]).toBe(projectRoot);
  });

  it("keeps an existing ~ alias instead of overriding it", () => {
    const mock = createMockNitro({ alias: { "~": "/custom" } });
    setup(mock);
    expect(mock.options.alias["~"]).toBe("/custom");
  });

  it("registers dev-only routes and the ordered middleware chain", () => {
    const mock = createMockNitro();
    setup(mock);

    const routes = mock.options.handlers.filter((handler) => handler["middleware"] !== true);
    const devRoutes = routes.filter((handler) => handler["env"] === "dev");
    expect(devRoutes.map((handler) => handler["route"])).toEqual([
      "/__facilis/manifest",
      "/__facilis/manifest/revision",
      "/__facilis/health",
      DEV_SCHEMA_ROUTE,
      DEV_QUERY_ROUTE,
      DEV_VIEW_ROUTE,
      SECURITY_SURFACE_ROUTE,
      OPENAPI_FACADE_ROUTE,
    ]);
    // The SSO namespace is framework auth in every environment (D-120), so it has no env gate.
    const sso = routes.filter((handler) => handler["route"] === SSO_ROUTE);
    expect(sso).toHaveLength(1);
    expect(sso[0]?.["env"]).toBeUndefined();

    const middleware = mock.options.handlers.filter((handler) => handler["middleware"] === true);
    expect(middleware.map((handler) => handler["route"])).toEqual(["/**", "/**", "/**"]);
    // cors runs first so a preflight is answered without booting db/auth.
    expect(middleware[0]?.["handler"]).toMatch(/middleware[\\/]cors\.ts$/);
    expect(middleware[1]?.["handler"]).toMatch(/middleware[\\/]context\.ts$/);
    expect(middleware[2]?.["handler"]).toMatch(/middleware[\\/]session\.ts$/);
  });

  it("mounts the telemetry ingestion route in dev and production without an env gate (D-203)", () => {
    // The handler itself answers 404 unless the deploy enabled telemetry in a production
    // boot; registration is unconditional like SSO/token, and the dev-only 404 guards are
    // per-route, so invariant 6 is untouched.
    for (const dev of [true, false]) {
      const mock = createMockNitro({ dev });
      setup(mock);
      const ingestion = mock.options.handlers.filter(
        (handler) => handler["route"] === TELEMETRY_TRACES_ROUTE,
      );
      expect(ingestion).toHaveLength(1);
      expect(ingestion[0]?.["env"]).toBeUndefined();
      expect(ingestion[0]?.["handler"]).toMatch(/routes[\\/]telemetry-traces\.ts$/);
    }
  });

  it("registers the backend telemetry plugin once (D-203)", () => {
    const mock = createMockNitro();
    setup(mock);
    expect(mock.options.plugins).toHaveLength(1);
    expect(mock.options.plugins[0]).toMatch(/plugins[\\/]telemetry\.ts$/);
  });

  it("relocates Nitro's own OpenAPI handler to the internal route", () => {
    const nativeHandler = {
      route: "/_openapi.json",
      handler: "/repo/node_modules/nitro/dist/runtime/internal/routes/openapi.mjs",
    };
    const mock = createMockNitro({
      handlers: [nativeHandler],
      openAPI: { route: "/_openapi.json" },
    });
    setup(mock);

    expect(nativeHandler.route).toBe(NATIVE_OPENAPI_ROUTE);
    expect(mock.options.openAPI?.route).toBe(NATIVE_OPENAPI_ROUTE);
  });

  it("generates a config virtual module pointing at the project config", async () => {
    const mock = createMockNitro();
    setup(mock);

    const code = await render(mock.options.virtual[VIRTUAL_CONFIG_ID]);
    expect(code).toContain("export default config;");
    expect(code).toContain(`facilis.config.ts`);
    expect(code).toContain("export const configError = undefined;");
    expect(code).toContain(`export const coreVersion = ${JSON.stringify(coreVersion)};`);
  });

  it("degrades gracefully when facilis.config.ts is missing", async () => {
    const mock = createMockNitro({ rootDir: `${projectRoot}/does-not-exist/` });
    setup(mock);

    const code = await render(mock.options.virtual[VIRTUAL_CONFIG_ID]);
    expect(code).toContain("export default {};");
    expect(code).toContain("facilis.config.ts not found");
  });

  it("exports the project schema namespace", async () => {
    const mock = createMockNitro();
    setup(mock);

    const code = await render(mock.options.virtual[VIRTUAL_DB_SCHEMA_ID]);
    expect(code).toContain("import * as schema from");
    expect(code).toContain("db/schema.ts");
  });

  it("exports an empty views module when the project declares no views", async () => {
    const mock = createMockNitro();
    setup(mock);

    const code = await render(mock.options.virtual[VIRTUAL_DB_VIEWS_ID]);
    expect(code).toBe("export default [];");
  });

  it("collects db/views/*.ts and db/views.ts into the views module", () => {
    const directory = mkdtempSync(join(tmpdir(), "facilis-views-"));
    try {
      mkdirSync(join(directory, "db", "views"), { recursive: true });
      writeFileSync(join(directory, "db", "views.ts"), "export {};");
      writeFileSync(join(directory, "db", "views", "b.ts"), "export {};");
      writeFileSync(join(directory, "db", "views", "a.ts"), "export {};");
      writeFileSync(join(directory, "db", "views", "a.test.ts"), "export {};");
      const mock = createMockNitro({ rootDir: directory });
      setup(mock);

      const template = mock.options.virtual[VIRTUAL_DB_VIEWS_ID];
      expect(typeof template).toBe("function");
      const code = (template as () => string)();
      expect(code).toContain("db/views.ts");
      expect(code.indexOf("a.ts")).toBeLessThan(code.indexOf("b.ts"));
      expect(code).not.toContain("a.test.ts");
      expect(code).toContain("export default [v0, v1, v2];");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("exports the project's server/jobs definitions as the jobs virtual module", async () => {
    const mock = createMockNitro();
    setup(mock);

    const code = await render(mock.options.virtual[VIRTUAL_JOBS_ID]);
    expect(code).toContain("import job0 from");
    expect(code).toContain('file: "server/jobs/ping.ts"');
    expect(code).toContain("definition: job0");
  });

  it("exports an empty jobs module when the project declares none", async () => {
    const mock = createMockNitro({ rootDir: `${projectRoot}/does-not-exist/` });
    setup(mock);

    expect(await render(mock.options.virtual[VIRTUAL_JOBS_ID])).toBe("export default [];");
  });

  it("exports the project's server/workflows definitions as the workflows virtual module", async () => {
    const mock = createMockNitro();
    setup(mock);

    const code = await render(mock.options.virtual[VIRTUAL_WORKFLOWS_ID]);
    expect(code).toContain("import workflow0 from");
    expect(code).toContain('file: "server/workflows/fixture.ts"');
    expect(code).toContain("definition: workflow0");
  });

  it("exports an empty workflows module when the project declares none", async () => {
    const mock = createMockNitro({ rootDir: `${projectRoot}/does-not-exist/` });
    setup(mock);

    expect(await render(mock.options.virtual[VIRTUAL_WORKFLOWS_ID])).toBe("export default [];");
  });

  it("recurses into nested job directories, sorted, ignoring tests", () => {
    const directory = mkdtempSync(join(tmpdir(), "facilis-jobs-"));
    try {
      mkdirSync(join(directory, "server", "jobs", "nested"), { recursive: true });
      writeFileSync(join(directory, "server", "jobs", "b.ts"), "export {};");
      writeFileSync(join(directory, "server", "jobs", "a.ts"), "export {};");
      writeFileSync(join(directory, "server", "jobs", "a.test.ts"), "export {};");
      writeFileSync(join(directory, "server", "jobs", "nested", "c.ts"), "export {};");
      const mock = createMockNitro({ rootDir: directory });
      setup(mock);

      const template = mock.options.virtual[VIRTUAL_JOBS_ID];
      expect(typeof template).toBe("function");
      const code = (template as () => string)();
      expect(code.indexOf("server/jobs/a.ts")).toBeLessThan(code.indexOf("server/jobs/b.ts"));
      expect(code.indexOf("server/jobs/b.ts")).toBeLessThan(
        code.indexOf("server/jobs/nested/c.ts"),
      );
      expect(code).not.toContain("a.test.ts");
      expect(code).toContain("export default [{");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("never registers #facilis/openapi-meta: the Vite plugin must own it", () => {
    const mock = createMockNitro();
    setup(mock);

    // A Nitro virtual module would shadow the facilis() plugin's module in the nitro
    // environment, so route-file HMR invalidations would never be observed.
    expect(mock.options.virtual[VIRTUAL_OPENAPI_META_ID]).toBeUndefined();
  });

  it("does not register dev routes in a production build", () => {
    const mock = createMockNitro({ dev: false });
    setup(mock);

    const routes = mock.options.handlers.filter((handler) => handler["middleware"] !== true);
    // The SSO namespace and the token endpoint are framework auth in production too
    // (D-120, v3a); the ingestion route is framework infrastructure in every environment
    // (D-203) and answers 404 itself when disabled. Nothing dev-only ships.
    expect(routes.map((handler) => handler["route"])).toEqual([
      SSO_ROUTE,
      TOKEN_ROUTE,
      TELEMETRY_TRACES_ROUTE,
    ]);
    // Auth still works in production: middleware is environment-agnostic.
    expect(mock.options.handlers.filter((handler) => handler["middleware"] === true)).toHaveLength(
      3,
    );
  });

  it("registers the facade in production only when OpenAPI production output is on", () => {
    const disabled = createMockNitro({ dev: false });
    setup(disabled);
    expect(disabled.options.handlers.some((h) => h["route"] === OPENAPI_FACADE_ROUTE)).toBe(false);

    const enabled = createMockNitro({ dev: false, openAPI: { production: "runtime" } });
    setup(enabled);
    expect(enabled.options.handlers.some((h) => h["route"] === OPENAPI_FACADE_ROUTE)).toBe(true);
  });
});
