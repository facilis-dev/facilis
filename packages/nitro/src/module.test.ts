import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Nitro } from "nitro/types";

import { createFacilisNitroModule } from "./module.ts";
import { NATIVE_OPENAPI_ROUTE, OPENAPI_FACADE_ROUTE } from "./constants.ts";
import { VIRTUAL_CONFIG_ID, VIRTUAL_DB_SCHEMA_ID, VIRTUAL_OPENAPI_META_ID } from "./virtual-ids.ts";

const projectRoot = fileURLToPath(new URL("../test-fixtures/project", import.meta.url));

interface MockOptions {
  rootDir: string;
  dev: boolean;
  alias: Record<string, string>;
  virtual: Record<string, string | (() => string | Promise<string>)>;
  handlers: Array<Record<string, unknown>>;
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
    expect(routes.map((handler) => handler["route"])).toEqual([
      "/__facilis/manifest",
      "/__facilis/manifest/revision",
      "/__facilis/health",
      OPENAPI_FACADE_ROUTE,
    ]);
    expect(routes.every((handler) => handler["env"] === "dev")).toBe(true);

    const middleware = mock.options.handlers.filter((handler) => handler["middleware"] === true);
    expect(middleware.map((handler) => handler["route"])).toEqual(["/**", "/**"]);
    expect(middleware[0]?.["handler"]).toMatch(/middleware[\\/]context\.ts$/);
    expect(middleware[1]?.["handler"]).toMatch(/middleware[\\/]session\.ts$/);
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
    expect(code).toContain('export const coreVersion = "0.0.0";');
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
    expect(routes).toEqual([]);
    // Auth still works in production: middleware is environment-agnostic.
    expect(mock.options.handlers.filter((handler) => handler["middleware"] === true)).toHaveLength(
      2,
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
