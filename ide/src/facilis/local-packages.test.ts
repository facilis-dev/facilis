// Unit tests for the dev-only local workspace packages (issue #41, D-196).
//
// The pure helpers are browser-safe, so they run in the app's Vitest environment. The
// dev-server plugin's fs serving is exercised end to end by scripts/dev/smoke-ide.mjs.

import { describe, expect, it } from "vitest";
import {
  fetchLocalPackageFiles,
  localPackageDir,
  localPackageSpec,
  rewriteLocalManifest,
  type LocalPackageIndex,
} from "./local-packages";

describe("local package specs", () => {
  it("names the vendor directory and the file: dependency a project pins", () => {
    expect(localPackageDir("@facilis.dev/nitro")).toBe("vendor/facilis/nitro");
    expect(localPackageSpec("@facilis.dev/nitro")).toBe("file:./vendor/facilis/nitro");
    expect(localPackageSpec("@facilis.dev/db")).toBe("file:./vendor/facilis/db");
  });
});

describe("rewriteLocalManifest", () => {
  const internal = new Set(["@facilis.dev/db", "@facilis.dev/core"]);
  const workspace = {
    name: "@facilis.dev/core",
    version: "0.0.0",
    type: "module",
    main: "./src/index.ts",
    types: "./src/index.d.ts",
    exports: {
      ".": { types: "./src/index.d.ts", default: "./src/index.ts" },
      "./config": "./src/config.ts",
      "./package.json": "./package.json",
    },
    dependencies: { "@facilis.dev/db": "workspace:*", zod: "^4.0.0" },
    devDependencies: { vitest: "^3.0.0" },
    scripts: { build: "tsc -p tsconfig.build.json" },
  };

  it("resolves every entry to dist/*.js for the native ESM loader", () => {
    const out = rewriteLocalManifest(workspace, internal);
    expect(out.main).toBe("./dist/index.js");
    expect(out.types).toBe("./dist/index.d.ts");
    expect(out.exports).toEqual({
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      "./config": "./dist/config.js",
      "./package.json": "./package.json",
    });
  });

  it("rewrites internal deps to file:../<sibling> and keeps external ones", () => {
    const out = rewriteLocalManifest(workspace, internal);
    expect(out.dependencies).toEqual({ "@facilis.dev/db": "file:../db", zod: "^4.0.0" });
  });

  it("drops the workspace dev tooling and scripts", () => {
    const out = rewriteLocalManifest(workspace, internal);
    expect(out.devDependencies).toBeUndefined();
    expect(out.scripts).toBeUndefined();
    expect(out.name).toBe("@facilis.dev/core");
    expect(out.type).toBe("module");
  });

  it("does not mutate the source manifest", () => {
    rewriteLocalManifest(workspace, internal);
    expect(workspace.main).toBe("./src/index.ts");
    expect(workspace.dependencies["@facilis.dev/db"]).toBe("workspace:*");
  });
});

describe("fetchLocalPackageFiles", () => {
  const index: LocalPackageIndex = {
    packages: [
      { name: "@facilis.dev/db", bare: "db", files: ["package.json", "dist/index.js"] },
      { name: "@facilis.dev/core", bare: "core", files: ["package.json"] },
    ],
  };

  function stubFetch(bodies: Record<string, string>, type = "application/json"): typeof fetch {
    return (async (input: string) => {
      const url = String(input);
      const key = url.split("/__facilis/dev/packages/")[1] ?? url;
      const body = bodies[key];
      if (body === undefined) return new Response("nope", { status: 404 });
      return new Response(new TextEncoder().encode(body), { headers: { "content-type": type } });
    }) as unknown as typeof fetch;
  }

  it("copies each served file under vendor/facilis/<pkg>/<file>", async () => {
    const bodies: Record<string, string> = {
      "index.json": JSON.stringify(index),
      "db/package.json": '{"name":"@facilis.dev/db"}',
      "db/dist/index.js": "export const db = 1;",
      "core/package.json": '{"name":"@facilis.dev/core"}',
    };
    const payload = await fetchLocalPackageFiles("/__facilis/dev/packages/", stubFetch(bodies));
    expect(Object.keys(payload).sort()).toEqual([
      "vendor/facilis/core/package.json",
      "vendor/facilis/db/dist/index.js",
      "vendor/facilis/db/package.json",
    ]);
    expect(payload["vendor/facilis/db/dist/index.js"]).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(payload["vendor/facilis/db/dist/index.js"])).toBe(
      "export const db = 1;",
    );
  });

  it("fails loudly when the dev route is absent (index 404)", async () => {
    await expect(fetchLocalPackageFiles("/__facilis/dev/packages/", stubFetch({}))).rejects.toThrow(
      /index not served/,
    );
  });

  it("refuses the SPA's HTML fallback instead of writing it into the project", async () => {
    const bodies = { "index.json": JSON.stringify(index), "db/package.json": "<html></html>" };
    const fetchImpl = (async (input: string) => {
      const url = String(input);
      const key = url.split("/__facilis/dev/packages/")[1] ?? url;
      if (key === "index.json") {
        return new Response(JSON.stringify(index), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("<html></html>", { headers: { "content-type": "text/html" } });
    }) as unknown as typeof fetch;
    await expect(fetchLocalPackageFiles("/__facilis/dev/packages/", fetchImpl)).rejects.toThrow(
      /not served/,
    );
    void bodies;
  });
});
