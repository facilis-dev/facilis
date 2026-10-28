import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Nitro, NitroEventHandler, NitroModule } from "nitro/types";

import {
  HEALTH_ROUTE,
  MANIFEST_REVISION_ROUTE,
  MANIFEST_ROUTE,
  NATIVE_OPENAPI_ROUTE,
  OPENAPI_FACADE_ROUTE,
} from "./constants.ts";
import { VIRTUAL_CONFIG_ID, VIRTUAL_DB_SCHEMA_ID } from "./virtual-ids.ts";

const ROUTES_DIR = new URL("./routes/", import.meta.url);
const MIDDLEWARE_DIR = new URL("./middleware/", import.meta.url);
// The package ships twice: src/*.ts from the workspace (bundlers strip the types) and
// dist/*.js in a packed tarball, which a published or URL-installed project loads with a
// plain ESM loader. Nitro needs real file paths for its handlers, so derive the extension
// from THIS module rather than hardcoding ".ts" — otherwise a dist build registers handler
// files that do not exist (dist/routes/manifest.get.ts).
const RUNTIME_EXT = import.meta.url.endsWith(".ts") ? ".ts" : ".js";
const APPLICATION_ENTRY = "facilis.config.ts";
const DB_SCHEMA_ENTRY = join("db", "schema.ts");
const DEV_ENV = "dev";

/**
 * Facilis Nitro module (SPEC §5.6; nitro v3 has no defineNitroModule/kit, so it is a
 * plain object). Carried by the `nitro` key of the `facilis()` Vite plugin.
 */
export function createFacilisNitroModule(): NitroModule {
  return {
    name: "facilis",
    setup(nitro: Nitro): void {
      const rootDir = nitro.options.rootDir;
      registerProjectAlias(nitro, rootDir);
      registerVirtualModules(nitro, rootDir);
      relocateNativeOpenApi(nitro);
      registerRuntimeHandlers(nitro);
    },
  };
}

export const facilisNitroModule: NitroModule = createFacilisNitroModule();

/**
 * SPEC Appendix C uses the `~` alias for project imports in server routes; Nitro must
 * resolve it too or route files would only work on the client.
 */
function registerProjectAlias(nitro: Nitro, rootDir: string): void {
  nitro.options.alias ??= {};
  if (nitro.options.alias["~"] === undefined) {
    nitro.options.alias["~"] = rootDir.replace(/[\\/]+$/, "");
  }
}

function registerVirtualModules(nitro: Nitro, rootDir: string): void {
  const versions = readFrameworkVersions();
  nitro.options.virtual ??= {};
  nitro.options.virtual[VIRTUAL_CONFIG_ID] = () => renderConfigModule(rootDir, versions);
  nitro.options.virtual[VIRTUAL_DB_SCHEMA_ID] = () => renderDbSchemaModule(rootDir);
  // `#facilis/openapi-meta` is deliberately NOT registered here: Nitro's virtual plugin
  // runs before user Vite plugins inside the nitro environment, so a Nitro virtual would
  // shadow the `facilis()` plugin's module and route-file edits would never invalidate it
  // (verified: HMR served stale metadata). The Vite plugin owns that module.
}

function renderConfigModule(rootDir: string, versions: FrameworkVersions): string {
  const configPath = join(rootDir, APPLICATION_ENTRY);
  const source = readTextFile(configPath);
  const metadata = [
    `export const projectRoot = ${JSON.stringify(rootDir)};`,
    `export const configPath = ${JSON.stringify(configPath)};`,
    `export const configSource = ${JSON.stringify(source ?? "")};`,
    `export const configError = ${
      source === null ? JSON.stringify(`facilis.config.ts not found at ${configPath}`) : "undefined"
    };`,
    `export const coreVersion = ${JSON.stringify(versions.coreVersion)};`,
    `export const nitroVersion = ${JSON.stringify(versions.nitroVersion)};`,
  ];
  const body =
    source === null
      ? ["export default {};"]
      : [`import config from ${JSON.stringify(configPath)};`, "export default config;"];
  return [...body, ...metadata].join("\n");
}

function renderDbSchemaModule(rootDir: string): string {
  const schemaPath = join(rootDir, DB_SCHEMA_ENTRY);
  if (!existsSync(schemaPath)) return "export default {};";
  return `import * as schema from ${JSON.stringify(schemaPath)};\nexport default schema;`;
}

function readTextFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

interface FrameworkVersions {
  coreVersion: string;
  nitroVersion: string;
}

function readFrameworkVersions(): FrameworkVersions {
  const require = createRequire(import.meta.url);
  return {
    coreVersion: readPackageVersion(require, "@facilis/core/package.json"),
    nitroVersion: readPackageVersion(require, "nitro/package.json"),
  };
}

function readPackageVersion(require: NodeRequire, request: string): string {
  try {
    const packageJson = require(request) as { version?: unknown };
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Keep Nitro's own OpenAPI generator intact but move its route off the public path
 * (SPEC §6.9): `/_openapi.json` becomes the AST-augmented facade, the native document
 * stays available on `/_facilis/openapi.json` and is what the facade reads.
 */
function relocateNativeOpenApi(nitro: Nitro): void {
  for (const handler of nitro.options.handlers) {
    if (/internal[\\/]routes[\\/]openapi/.test(handler.handler)) {
      handler.route = NATIVE_OPENAPI_ROUTE;
    }
  }
  if (nitro.options.openAPI !== undefined) {
    nitro.options.openAPI.route = NATIVE_OPENAPI_ROUTE;
  }
}

function registerRuntimeHandlers(nitro: Nitro): void {
  const dev = nitro.options.dev === true;
  const handlers = nitro.options.handlers;
  const add = (route: string, handler: string, env?: NitroEventHandler["env"]): void => {
    handlers.push(env === undefined ? { route, handler } : { route, handler, env });
  };

  if (dev) {
    add(MANIFEST_ROUTE, routeFile("manifest.get.ts"), DEV_ENV);
    add(MANIFEST_REVISION_ROUTE, routeFile("manifest-revision.get.ts"), DEV_ENV);
    add(HEALTH_ROUTE, routeFile("health.get.ts"), DEV_ENV);
  }
  // The facade is dev-only unless the project explicitly enables OpenAPI in production.
  if (dev) add(OPENAPI_FACADE_ROUTE, routeFile("openapi.get.ts"), DEV_ENV);
  else if (nitro.options.openAPI?.production)
    add(OPENAPI_FACADE_ROUTE, routeFile("openapi.get.ts"));

  // Middleware order is significant: context (db) before session (auth) (contracts §4.1).
  handlers.push({ route: "/**", middleware: true, handler: middlewareFile("context.ts") });
  handlers.push({ route: "/**", middleware: true, handler: middlewareFile("session.ts") });
}

function routeFile(name: string): string {
  return fileURLToPath(new URL(withRuntimeExt(name), ROUTES_DIR));
}

function middlewareFile(name: string): string {
  return fileURLToPath(new URL(withRuntimeExt(name), MIDDLEWARE_DIR));
}

function withRuntimeExt(name: string): string {
  return name.replace(/\.ts$/, RUNTIME_EXT);
}
