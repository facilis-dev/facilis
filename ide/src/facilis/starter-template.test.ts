// The starter template is the empty full-stack app (D-168): the standard login surface and
// nothing else. These assertions are the drift guard for examples/starter-app, which the
// IDE inlines at build time: the generated project must get its auth routes, schema,
// migrations and login pages, the VM-only Nitro runner, and none of the todo demo.

import { describe, expect, it } from "vitest";
import { createStarterTemplate } from "./starter-template";
import { PROJECT_PACKAGE_MANAGER } from "./template-files";
import type { FacilisManifest } from "./template-types";

const template = createStarterTemplate();
const files = template.files;
const paths = Object.keys(files);

type PackageJson = {
  name: string;
  packageManager: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  overrides: Record<string, string>;
};

const pkg = JSON.parse(files["package.json"]) as PackageJson;

describe("starter template", () => {
  it("carries the example's login client, auth server routes, schema and migrations", () => {
    expect(paths).toEqual(
      expect.arrayContaining([
        "index.html",
        "vite.config.ts",
        "facilis.config.ts",
        ".gitignore",
        "src/app.tsx",
        "src/main.tsx",
        "src/styles.css",
        "src/pages/login.tsx",
        "src/pages/register.tsx",
        "src/pages/dashboard.tsx",
        "server/routes/api/auth/login.post.ts",
        "server/routes/api/auth/register.post.ts",
        "server/routes/api/auth/logout.post.ts",
        "server/routes/api/auth/session.get.ts",
        "db/schema.ts",
        "db/migrations/0000_auth_tables.sql",
        "locales/en.json",
        "locales/it.json",
      ]),
    );
    expect(files["src/app.tsx"]).toContain("<Routes>");
    expect(paths.some((path) => path.includes(".test."))).toBe(false);
  });

  it("ships no todo demo, jobs or file-upload surface", () => {
    expect(paths).not.toContain("src/pages/todos.tsx");
    expect(paths.some((path) => path.startsWith("server/routes/api/todos/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("server/jobs/"))).toBe(false);
    expect(paths).not.toContain("db/migrations/0003_fearless_shiver_man.sql");
    expect(files["db/schema.ts"]).not.toContain("todos");
    expect(files["db/schema.ts"]).not.toContain("facilisFiles");
  });

  it("installs the published framework packages and the IDE's npm", () => {
    expect(pkg.name).toBe("facilis-app");
    expect(pkg.packageManager).toBe(PROJECT_PACKAGE_MANAGER);
    expect(pkg.scripts.preinstall).toBe("node scripts/check-pm.mjs");
    // Workspace specs are pinned to the exact published version in the generated project
    // (D-166): a generated project must install from the registry, not from this repo.
    expect(pkg.dependencies["@facilis.dev/auth"]).toBeDefined();
    expect(pkg.dependencies["@facilis.dev/auth"]).not.toBe("workspace:*");
    expect(pkg.dependencies["@facilis.dev/nitro"]).toBeDefined();
    expect(pkg.devDependencies["@types/react"]).toBeTruthy();
    expect(pkg.devDependencies["@rolldown/binding-wasm32-wasi"]).toBeTruthy();
    expect(pkg.overrides["@emnapi/core"]).toBe("2.0.0-beta.2");
    // The example's own workspace tooling (oxlint/vitest/tsc) is not part of the project.
    expect(pkg.devDependencies).not.toHaveProperty("vitest");
    expect(pkg.devDependencies).not.toHaveProperty("oxlint");
  });

  it("gives the VM the in-process Nitro runner and the main release ref", () => {
    const config = files["facilis.config.ts"];
    // The example ships "origin/main" and no runner; the generated project cannot boot in
    // the WebContainer with the default node-worker runner (template-overrides.ts).
    expect(config).toContain('release: { ref: "main" }');
    expect(config).not.toContain("origin/main");
    expect(config).toContain('runner: "self"');
    // The example itself keeps the neutral anchors the override replaces.
    expect(paths).toContain("facilis.config.ts");
  });

  it("keeps the files that make it a Facilis project", () => {
    expect(files).toHaveProperty(".facilis/facilis.app.json");
    expect(files).toHaveProperty(".npmrc");
    expect(files).toHaveProperty("tsconfig.json");
    expect(files).toHaveProperty("README.md");
    expect(files).toHaveProperty("scripts/check-pm.mjs");
    const marker = JSON.parse(files[".facilis/facilis.app.json"]) as { template: string };
    expect(marker.template).toBe("facilis");
    const tsconfig = JSON.parse(files["tsconfig.json"]) as { include: string[] };
    expect(tsconfig.include).toEqual([
      "src",
      "server",
      "db",
      "vite.config.ts",
      "facilis.config.ts",
    ]);
  });

  it("runs the Nitro dev server on the preview port", () => {
    expect(template.manifest.id).toBe("facilis-starter");
    expect(template.manifest.port).toBe(3000);
    expect(template.manifest.dev).toBe("npm run dev -- --configLoader native");
    expect(template.manifest.install).toBe("npm install");
    expect(template.manifest.entry).toBe("src/app.tsx");
    expect(files[template.manifest.entry]).toBeDefined();
    expect((template.manifest as FacilisManifest).assets).toEqual([]);
  });
});
