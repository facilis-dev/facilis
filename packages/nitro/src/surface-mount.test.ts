import { describe, expect, it } from "vitest";
import type { Nitro } from "nitro/types";

import { enforceDeclaredSurface } from "./surface-mount.ts";
import { emptyAnalysis, routeFact } from "./route-metadata-test-harness.ts";

const ROOT = "/project";

function fakeNitro(handlers: string[], plugins: string[] = [], scanned: string[] = []) {
  return {
    options: {
      handlers: handlers.map((handler) => ({ route: "/x", handler })),
      plugins,
      modules: [],
      tasks: {},
    },
    scannedHandlers: scanned.map((handler) => ({ route: "/x", handler, middleware: false })),
  } as unknown as Nitro;
}

function analysisWith(
  routes: Array<{ file: string; surface: "standard" | "declared" | "undeclared" | "unknown" }>,
  extensions: Array<{ file: string; surface: "declared" | "undeclared" }> = [],
) {
  return emptyAnalysis({
    routes: routes.map((entry, index) =>
      routeFact({
        method: "GET",
        path: "/r" + index,
        sourceFile: entry.file,
        surface: {
          class: entry.surface,
          declarations:
            entry.surface === "declared"
              ? [
                  {
                    kind: "raw-route" as const,
                    reason: "why",
                    source: { file: entry.file, line: 1 },
                  },
                ]
              : [],
          source: { file: entry.file, line: 1 },
          unknown: [],
          rawSqlReason: null,
          rawDb: [],
        },
      }),
    ),
    surface: {
      extensions: extensions.map((entry) => ({
        file: entry.file,
        kind: "plugin" as const,
        surface: {
          class: entry.surface,
          declarations:
            entry.surface === "declared"
              ? [
                  {
                    kind: "server-extension" as const,
                    reason: "why",
                    source: { file: entry.file, line: 1 },
                  },
                ]
              : [],
          source: { file: entry.file, line: 1 },
          unknown: [],
        },
      })),
      forbiddenImports: [],
      dynamicCode: [],
      unknown: [],
      summary: { standard: 0, declared: 0, undeclared: 0, unknown: 0 },
    },
  });
}

describe("enforceDeclaredSurface (D-226)", () => {
  it("keeps only standard/declared project routes and framework handlers", () => {
    const nitro = fakeNitro([
      "/project/server/api/ok.get.ts",
      "/project/server/api/raw.get.ts",
      "/project/server/api/evil.get.ts",
      "/framework/routes/manifest.get.ts",
    ]);
    const analysis = analysisWith([
      { file: "server/api/ok.get.ts", surface: "standard" },
      { file: "server/api/raw.get.ts", surface: "declared" },
      { file: "server/api/evil.get.ts", surface: "undeclared" },
    ]);
    enforceDeclaredSurface(nitro, ROOT, analysis);
    expect(nitro.options.handlers.map((handler) => handler.handler)).toEqual([
      "/project/server/api/ok.get.ts",
      "/project/server/api/raw.get.ts",
      "/framework/routes/manifest.get.ts",
    ]);
  });

  it("drops an undeclared plugin and middleware but keeps a declared one", () => {
    const nitro = fakeNitro(
      [],
      ["/project/server/plugins/ids.ts", "/project/server/plugins/evil.ts", "framework-plugin"],
      ["/project/server/middleware/auth.ts", "/project/server/middleware/evil.ts"],
    );
    const analysis = analysisWith(
      [],
      [
        { file: "server/plugins/ids.ts", surface: "declared" },
        { file: "server/plugins/evil.ts", surface: "undeclared" },
        { file: "server/middleware/auth.ts", surface: "declared" },
      ],
    );
    enforceDeclaredSurface(nitro, ROOT, analysis);
    expect(nitro.options.plugins).toEqual(["/project/server/plugins/ids.ts", "framework-plugin"]);
    expect(nitro.scannedHandlers.map((handler) => handler.handler)).toEqual([
      "/project/server/middleware/auth.ts",
    ]);
  });

  it("re-filters every later scan through the intercepted property", () => {
    const nitro = fakeNitro([]);
    const analysis = analysisWith([{ file: "server/api/ok.get.ts", surface: "standard" }]);
    enforceDeclaredSurface(nitro, ROOT, analysis);
    nitro.scannedHandlers = [
      { route: "/x", handler: "/project/server/api/ok.get.ts" },
      { route: "/y", handler: "/project/server/api/new.get.ts" },
    ];
    expect(nitro.scannedHandlers.map((handler) => handler.handler)).toEqual([
      "/project/server/api/ok.get.ts",
    ]);
  });
});
