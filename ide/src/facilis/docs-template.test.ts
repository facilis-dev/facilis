// The docs template is a static Vite app (D-168, issue #163): the IDE must not add a
// server, a database or a facilis.config.ts to it, and its package.json must install in
// the VM with no @facilis.dev runtime dependency. These assertions are the contract test
// mirroring showcase-template.test.ts, plus the D-062 drift guard: the generated project
// IS examples/docs-app, byte for byte, plus the files the IDE owns.

import { describe, expect, it } from "vitest";
import { createDocsTemplate, docsExampleSources } from "./docs-template";
import { PROJECT_PACKAGE_MANAGER } from "./template-files";
import type { FacilisManifest } from "./template-types";

const template = createDocsTemplate();
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

describe("docs template", () => {
  it("carries the example's client, content, locales and Vite config", () => {
    expect(paths).toEqual(
      expect.arrayContaining([
        "index.html",
        "vite.config.ts",
        ".gitignore",
        "src/app.tsx",
        "src/main.tsx",
        "src/styles.css",
        "src/pages/home.tsx",
        "src/pages/doc.tsx",
        "src/pages/catch-all.tsx",
        "src/pages/not-found.tsx",
        "src/layouts/docs-layout.tsx",
        "src/components/docs-sidebar.tsx",
        "src/components/doc-toc.tsx",
        "src/components/doc-pager.tsx",
        "src/lib/docs.ts",
        "src/lib/frontmatter.ts",
        "src/lib/markdown.ts",
        "src/lib/mdx.ts",
        "locales/en.json",
        "locales/it.json",
      ]),
    );
    // The content files ARE the pages: the template must ship them verbatim.
    expect(paths).toEqual(
      expect.arrayContaining([
        "src/content/docs/index.md",
        "src/content/docs/getting-started.md",
        "src/content/docs/guides/index.md",
        "src/content/docs/guides/content-pipeline.md",
        "src/content/docs/guides/navigation.mdx",
        "src/content/docs/reference/frontmatter.md",
      ]),
    );
    // The route table the IDE's graph reads (D-160): pages stay files under src/pages.
    expect(files["src/app.tsx"]).toContain("<Routes>");
    expect(files["vite.config.ts"]).toContain("port: 3000");
    // The static prerender declaration (D-202): one plugin call with a literal allowlist
    // covering the docs routes, so the IDE previews prerendered docs pages.
    expect(files["vite.config.ts"]).toContain(
      'import { prerender } from "@facilis.dev/nitro/prerender";',
    );
    expect(files["vite.config.ts"]).toContain('"/docs/getting-started"');
    expect(files["vite.config.ts"]).toContain('"/docs/guides/navigation"');
    expect(paths.some((path) => path.includes(".test."))).toBe(false);
  });

  it("ships no backend, database or framework config", () => {
    expect(paths.some((path) => path.startsWith("server/"))).toBe(false);
    expect(paths.some((path) => path.startsWith("db/"))).toBe(false);
    expect(paths).not.toContain("facilis.config.ts");
    // D-202/D-168 amendment: the runtime stays framework-free, but the static template carries
    // exactly one build-time-only devDependency — the prerender Vite plugin entry.
    expect(Object.keys(pkg.dependencies).some((name) => name.startsWith("@facilis.dev/"))).toBe(
      false,
    );
    expect(
      Object.keys(pkg.devDependencies).filter((name) => name.startsWith("@facilis.dev/")),
    ).toEqual(["@facilis.dev/nitro"]);
    // Release mode pins the package's own exact version, never the example's workspace spec.
    expect(pkg.devDependencies["@facilis.dev/nitro"]).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
  });

  it("keeps the content pipeline pure JS for the WebContainer", () => {
    // marked (Markdown) and @mdx-js/mdx (MDX) are the whole pipeline: pure JS, no native
    // binary, no build-time content plugin — the prerender SSR sub-build loads no Vite
    // config, so render-time evaluation is the one shape that works there (D-202).
    expect(pkg.dependencies["marked"]).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
    expect(pkg.dependencies["@mdx-js/mdx"]).toMatch(/^[0-9]+\.[0-9]+\.[0-9]+$/);
    expect(files["src/lib/docs.ts"]).toContain("import.meta.glob");
    expect(files["src/lib/docs.ts"]).toContain("?raw");
    expect(files["src/lib/mdx.ts"]).toContain("evaluateSync");
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
    // The README documents the content convention the template ships.
    expect(files["README.md"]).toContain("src/content/docs/");
  });

  it("runs a plain Vite dev server on the preview port", () => {
    expect(template.manifest.id).toBe("facilis-docs");
    expect(template.manifest.port).toBe(3000);
    expect(template.manifest.dev).toBe("npm run dev -- --configLoader native");
    expect(template.manifest.install).toBe("npm install");
    expect(template.manifest.entry).toBe("src/app.tsx");
    expect(files[template.manifest.entry]).toBeDefined();
    expect((template.manifest as FacilisManifest).assets).toEqual([]);
  });
});

// The D-062 drift guard extended to the docs kind (D-168): the generated project is the
// example byte for byte — the docs template has no overrides at all.
describe("generated docs project source", () => {
  const example = docsExampleSources().files;

  it("carries every example file, byte-identical", () => {
    expect(Object.keys(example).length).toBeGreaterThan(0);
    for (const [path, source] of Object.entries(example)) {
      expect(files[path], "missing " + path).toBeDefined();
      expect(files[path], path).toBe(source);
    }
  });

  it("skips test files and the example's own package.json/tsconfig", () => {
    expect(Object.keys(example).some((path) => path.includes(".test."))).toBe(false);
    expect(example).not.toHaveProperty("package.json");
    expect(example).not.toHaveProperty("tsconfig.json");
    expect(example).not.toHaveProperty("vitest.config.ts");
  });
});
