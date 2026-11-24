// The wrappers of a static template (frontend only): the generated package.json, its
// tsconfig include and its README (D-168).
//
// A static example ships a real package.json (no @facilis.dev dependencies, no backend),
// so this one is not rebuilt from a full-stack shape: the example's dependency versions
// are kept and only the VM constraints are added — the npm the IDE vendors with its
// preinstall guard, the wasm32 bindings Vite 8 and Tailwind v4 need where
// process.arch is "wasm32" (DEV.md 6.1). Test/lint tooling stays out: the generated
// project is a site, not a workspace member.

import { frameworkPackageMinimums } from "@/deploy/current";
import { publishedFrameworkPin } from "./package-minimums";
import { localPackageSpec, localPackagesEnabled } from "./local-packages";
import { PROJECT_PACKAGE_MANAGER, VM_OVERRIDES, vmDevDependencies } from "./template-files";

type StaticPackage = {
  version?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

/** Paths a static project typechecks: the client and its Vite config. */
export const STATIC_TSCONFIG_INCLUDE = ["src", "vite.config.ts"] as const;

/** Dev dependencies that belong to the example's own workspace setup, not the project. */
const EXAMPLE_ONLY_DEV_DEPENDENCIES = new Set(["oxlint", "typescript", "vitest"]);

export const SHOWCASE_README = `# facilis-app

A static site scaffolded by the Facilis IDE: React 19 + Vite 8 + Tailwind CSS v4,
frontend only. There is no server, no database and no facilis.config.ts — the project is
a plain Vite app, so "npm run dev" is the whole runtime.

## Package manager

npm, the one the IDE vendors and keeps aligned with its Node version:

    npm run dev

"npm run dev" expects dependencies to be installed: the IDE's Run installs them for
you, or run "npm install" yourself before it.

The preinstall guard rejects other package managers on purpose.
`;

export const DOCS_README = `# facilis-app

A documentation site scaffolded by the Facilis IDE: React 19 + Vite + Tailwind CSS v4,
frontend only. There is no server, no database and no facilis.config.ts — the project is
a plain Vite app, so "npm run dev" is the whole runtime.

## Content

Pages are Markdown (.md) and MDX (.mdx) files under src/content/docs/. A file becomes a
page at a file-derived route (guides/navigation.mdx -> /docs/guides/navigation; an index
file maps to its directory). The sidebar, prev/next links and per-page tables of contents
derive from the same content tree, so adding a file needs no React edit.

Each file opens with a frontmatter block: title (string), description (string) and order
(integer, the reading order within its section). Rendering is pure JS at render time —
marked for Markdown, @mdx-js/mdx evaluateSync for MDX — so the same content works in the
dev server, the client build and the prerender pass.

## Prerendering

vite.config.ts declares the routes that build to static HTML (D-202). A new page is
served by the catch-all immediately; to prerender it too, add its literal route to
src/app.tsx and to the prerender allowlist.

## Package manager

npm, the one the IDE vendors and keeps aligned with its Node version:

    npm run dev

"npm run dev" expects dependencies to be installed: the IDE's Run installs them for
you, or run "npm install" yourself before it.

The preinstall guard rejects other package managers on purpose.
`;

/**
 * The static project's package.json, from the example's own one.
 *
 * @param exampleSource the example's package.json; the source of every dependency version.
 */
export function staticPackageJson(
  exampleSource: string,
  local: boolean = localPackagesEnabled,
): string {
  const example = JSON.parse(exampleSource) as StaticPackage;
  const dependencies: Record<string, string> = {};
  for (const [name, spec] of Object.entries(example.dependencies ?? {})) {
    // A static template has no framework RUNTIME packages; keep the same rule the full-stack
    // template uses for any that appear — each package's own exact version (D-166/D-198),
    // or a file: spec for the dev local path (issue #41, D-196) — never a workspace spec.
    dependencies[name] = name.startsWith("@facilis.dev/")
      ? local
        ? localPackageSpec(name)
        : publishedFrameworkPin(name, frameworkPackageMinimums)
      : spec;
  }
  const devDependencies: Record<string, string> = {};
  for (const [name, spec] of Object.entries(example.devDependencies ?? {})) {
    if (EXAMPLE_ONLY_DEV_DEPENDENCIES.has(name) || spec === "catalog:") continue;
    // The static template carries one build-time-only framework devDependency: the prerender
    // Vite plugin (D-202/D-168 amendment). Pin it like a runtime dep — each package's own exact
    // version (D-166/D-198) or the dev local path (D-196) — never a workspace spec; the runtime
    // stays framework-free.
    devDependencies[name] = name.startsWith("@facilis.dev/")
      ? local
        ? localPackageSpec(name)
        : publishedFrameworkPin(name, frameworkPackageMinimums)
      : spec;
  }
  const scripts: Record<string, string> = {};
  for (const name of ["dev", "build", "preview"] as const) {
    const script = example.scripts?.[name];
    if (script !== undefined) scripts[name] = script;
  }
  return (
    JSON.stringify(
      {
        name: "facilis-app",
        private: true,
        version: example.version ?? "0.0.0",
        type: "module",
        packageManager: PROJECT_PACKAGE_MANAGER,
        scripts: { ...scripts, preinstall: "node scripts/check-pm.mjs" },
        dependencies,
        devDependencies: {
          ...devDependencies,
          ...vmDevDependencies(example.devDependencies?.["tailwindcss"]),
        },
        overrides: VM_OVERRIDES,
        ...(example.engines === undefined ? {} : { engines: example.engines }),
      },
      null,
      2,
    ) + "\n"
  );
}
