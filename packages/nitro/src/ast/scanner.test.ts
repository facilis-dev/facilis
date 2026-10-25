import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { ManifestWarning } from "@facilis/core";

import { scanRouteMetadata } from "./scanner.ts";

const projectRoot = fileURLToPath(new URL("../../test-fixtures/project", import.meta.url));
const routesDir = fileURLToPath(
  new URL("../../test-fixtures/project/server/routes", import.meta.url),
);

describe("scanRouteMetadata", () => {
  it("extracts wrapped defineAuthorizedHandler configs", async () => {
    const metadata = await scanRouteMetadata({ routesDir, rootDir: projectRoot });

    expect(metadata["/health"]?.["get"]).toMatchObject({
      method: "GET",
      permission: [],
      dbTables: [],
      description: "Health probe.",
      unresolved: [],
      sourceFile: "server/routes/health.get.ts",
    });
    expect(metadata["/api/todos"]?.post).toMatchObject({
      method: "POST",
      permission: "todos:write",
      dbTables: ["todos"],
      dbColumns: ["todos.title", "todos.ownerId"],
      sourceFile: "server/routes/api/todos/index.post.ts",
    });
    expect(metadata["/api/todos/{id}"]?.patch).toMatchObject({
      method: "PATCH",
      permission: ["todos:write", "todos:read"],
      dbTables: ["todos"],
    });
  });

  it("falls back to top-level defineRouteMeta", async () => {
    const metadata = await scanRouteMetadata({ routesDir, rootDir: projectRoot });
    expect(metadata["/manual"]?.["get"]).toMatchObject({
      permission: "todos:read",
      dbTables: ["todos"],
      dbColumns: ["todos.title"],
      description: "Manual top-level metadata.",
      unresolved: [],
    });
  });

  it("warns instead of guessing for non-static config values", async () => {
    const warnings: ManifestWarning[] = [];
    const metadata = await scanRouteMetadata({
      routesDir,
      rootDir: projectRoot,
      onWarning: (warning) => warnings.push(warning),
    });

    const dynamic = metadata["/dynamic"]?.get;
    expect(dynamic?.unresolved).toEqual(["dbTables"]);
    expect(dynamic?.dbTables).toEqual([]);
    expect(dynamic?.warnings).toHaveLength(1);
    expect(dynamic?.warnings[0]).toMatchObject({
      code: "meta-not-static",
      section: "routes",
      sourceFile: "server/routes/dynamic.get.ts",
    });
    expect(warnings).toEqual([]);
  });

  it("skips route files without static metadata", async () => {
    const metadata = await scanRouteMetadata({ routesDir, rootDir: projectRoot });
    expect(metadata["/plain"]).toBeUndefined();
  });

  it("returns an empty map for a missing routes directory", async () => {
    const warnings: ManifestWarning[] = [];
    const metadata = await scanRouteMetadata({
      routesDir: fileURLToPath(new URL("../../test-fixtures/missing", import.meta.url)),
      rootDir: projectRoot,
      onWarning: (warning) => warnings.push(warning),
    });
    expect(metadata).toEqual({});
    expect(warnings).toEqual([]);
  });

  it("is deterministic across runs", async () => {
    const first = await scanRouteMetadata({ routesDir, rootDir: projectRoot });
    const second = await scanRouteMetadata({ routesDir, rootDir: projectRoot });
    expect(second).toEqual(first);
  });
});
