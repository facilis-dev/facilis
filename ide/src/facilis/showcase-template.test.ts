// The showcase template is a static Vite app (D-168): the IDE must not add a server, a
// database or a facilis.config.ts to it, and its package.json must install in the VM
// without any @facilis.dev dependency. These assertions are the drift guard for
// examples/showcase-app, which the IDE inlines at build time.

import { describe, expect, it } from "vitest";
import { createShowcaseTemplate } from "./showcase-template";
import { PROJECT_PACKAGE_MANAGER } from "./template-files";
import type { FacilisManifest } from "./template-types";

const template = createShowcaseTemplate();
const files = template.files;
const paths = Object.keys(files);

type PackageJson = {
  packageManager: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  overrides: Record<string, string>;
};

const pkg = JSON.parse(files["package.json"]) as PackageJson;

describe("showcase template", () => {
  it("carries the example's client, routes, locales and Vite config", () => {
    expect(paths).toEqual(
      expect.arrayContaining([
        "index.html",
        "vite.config.ts",
        ".gitignore",
        "src/app.tsx",
        "src/main.tsx",
        "src/styles.css",
        "src/pages/home.tsx",
        "src/pages/features.tsx",
        "src/pages/showcase.tsx",
        "src/pages/contact.tsx",
        "locales/en.json",
        "locales/it.json",
      ]),
    );
    // The route table the IDE's graph reads (D-160): pages stay files under src/pages.
    expect(files["src/app.tsx"]).toContain("<Routes>");
    expect(files["vite.config.ts"]).toContain("port: 3000");
    expect(paths.some((path) => path.includes(".test."))).toBe(false);
  });

  it("ships no backend, database or framework config", () => {
    expect(paths.some((path) => path.startsWith("server/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("db/"))).toBe(false);
    expect(paths).not.toContain("facilis.config.ts");
    expect(files["package.json"]).not.toContain("@facilis.dev/");
  });

  it("installs with the IDE's npm and the VM-only wasm bindings", () => {
    // One constant for every template; package-manager.test.ts pins it to the vendored npm.
    expect(pkg.packageManager).toBe(PROJECT_PACKAGE_MANAGER);
    expect(pkg.scripts.preinstall).toBe("node scripts/check-pm.mjs");
    expect(pkg.devDependencies["@rolldown/binding-wasm32-wasi"]).toBeTruthy();
    // The oxide binding must move in lockstep with the engine it was built against.
    expect(pkg.devDependencies["@tailwindcss/oxide-wasm32-wasi"]).toBe(
      pkg.devDependencies["tailwindcss"],
    );
    expect(pkg.overrides["@emnapi/core"]).toBe("2.0.0-beta.2");
    // Test/lint tooling belongs to the example's workspace, not the generated site.
    expect(pkg.devDependencies).not.toHaveProperty("vitest");
    expect(pkg.scripts).not.toHaveProperty("test");
  });

  it("keeps the files that make it a Facilis project", () => {
    expect(files).toHaveProperty(".facilis/facilis.app.json");
    expect(files).toHaveProperty(".npmrc");
    expect(files).toHaveProperty("tsconfig.json");
    expect(files).toHaveProperty("README.md");
    expect(files).toHaveProperty("scripts/check-pm.mjs");
    // Every variant keeps the marker's template value: admission asks "is this a Facilis
    // project", never which kind (app-manifest.ts, D-168).
    const marker = JSON.parse(files[".facilis/facilis.app.json"]) as { template: string };
    expect(marker.template).toBe("facilis");
    // A static project typechecks the client and its Vite config, not a server tree.
    const tsconfig = JSON.parse(files["tsconfig.json"]) as { include: string[] };
    expect(tsconfig.include).toEqual(["src", "vite.config.ts"]);
  });

  it("runs a plain Vite dev server on the preview port", () => {
    expect(template.manifest.id).toBe("facilis-showcase");
    expect(template.manifest.port).toBe(3000);
    expect(template.manifest.dev).toBe("npm run dev -- --configLoader native");
    expect(template.manifest.install).toBe("npm install");
    expect(template.manifest.entry).toBe("src/app.tsx");
    expect(files[template.manifest.entry]).toBeDefined();
    expect((template.manifest as FacilisManifest).assets).toEqual([]);
  });
});
