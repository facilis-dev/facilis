import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Nitro } from "nitro/types";
import type { FacilisDb } from "@facilis.dev/db";

import { attachRequestDatabase } from "@facilis.dev/core";
import { parseSecuritySurface } from "@facilis.dev/core";

import { analyzeProjectRoutes } from "./route-metadata.ts";
import { enforceDeclaredSurface } from "./surface-mount.ts";
import { buildSecuritySurfaceDocument, securitySurfaceIssues } from "./security-surface.ts";

const ROOT = fileURLToPath(new URL("./test-fixtures/surface-project/", import.meta.url)).replace(
  /\/$/,
  "",
);

function fakeDb(): FacilisDb {
  const tx = {
    execute: async () => ({ rows: [] }),
    transaction: async (fn: (inner: unknown) => Promise<unknown>) => fn(tx),
  };
  return {
    db: {
      transaction: async (fn: (inner: unknown) => Promise<unknown>) => fn(tx),
    },
  } as unknown as FacilisDb;
}

function fakeNitro(): Nitro {
  return {
    options: {
      handlers: [],
      plugins: [ROOT + "/server/plugins/declared.ts", ROOT + "/server/plugins/undeclared.ts"],
      modules: [],
      tasks: {},
    },
    scannedHandlers: [
      { route: "/api/declared", handler: ROOT + "/server/api/declared.post.ts", middleware: false },
      {
        route: "/api/undeclared",
        handler: ROOT + "/server/api/undeclared.get.ts",
        middleware: false,
      },
    ],
  } as unknown as Nitro;
}

describe("declared-surface end to end (D-226, epic #228)", () => {
  const analysis = analyzeProjectRoutes(ROOT);

  it("fails the build on every undeclared fixture", () => {
    expect(analysis).toBeDefined();
    if (analysis === undefined) return;
    const codes = securitySurfaceIssues(analysis).map((issue) => issue.code);
    expect(codes).toContain("surface-undeclared");
    expect(codes).toContain("surface-forbidden-import");
    expect(new Set(codes)).toEqual(new Set(["surface-undeclared", "surface-forbidden-import"]));
  });

  it("mounts the declared route and drops the undeclared one", () => {
    if (analysis === undefined) throw new Error("fixture analysis missing");
    const nitro = fakeNitro();
    enforceDeclaredSurface(nitro, ROOT, analysis);
    expect(nitro.scannedHandlers.map((entry) => entry.handler)).toEqual([
      ROOT + "/server/api/declared.post.ts",
    ]);
    expect(nitro.options.plugins).toEqual([ROOT + "/server/plugins/declared.ts"]);
  });

  it("exports every class with the declared reason and the forbidden import", () => {
    if (analysis === undefined) throw new Error("fixture analysis missing");
    const document = buildSecuritySurfaceDocument(analysis, "surface-fixture");
    expect(parseSecuritySurface(document).ok).toBe(true);
    const declared = document.routes.find((route) =>
      route.source.file.endsWith("declared.post.ts"),
    );
    expect(declared?.class).toBe("declared");
    expect(declared?.declarations[0]?.reason).toContain("signed vendor callback");
    expect(document.imports.map((entry) => entry.symbol)).toContain("createDb");
    expect(document.dynamicCode[0]?.form).toBe("eval");
    expect(document.summary.undeclared).toBeGreaterThan(0);
  });

  it("serves the declared raw route without the ambient db and keeps the origin gate", async () => {
    const module =
      (await import("./test-fixtures/surface-project/server/api/declared.post.ts")) as {
        default: (event: unknown) => Promise<unknown>;
      };
    const event = {
      context: { facilis: {} },
      req: {
        headers: new Headers({ "content-type": "application/json" }),
        url: "http://localhost/api/declared",
        method: "POST",
      },
    };
    attachRequestDatabase(event, fakeDb());
    const result = (await module.default(event)) as {
      ok: boolean;
      leaked: boolean;
      rawDb: boolean;
    };
    expect(result).toEqual({ ok: true, leaked: false, rawDb: true });

    const crossed = {
      context: { facilis: {} },
      req: {
        headers: new Headers({
          "content-type": "application/json",
          origin: "https://evil.example",
          host: "localhost",
        }),
        url: "http://localhost/api/declared",
        method: "POST",
      },
    };
    attachRequestDatabase(crossed, fakeDb());
    const denied = (await module.default(crossed)) as Response;
    expect(denied.status).toBe(403);
  });
});
