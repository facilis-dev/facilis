// The wrappers of a static template (frontend only): the generated package.json, its
// tsconfig include and its README (D-168).
//
// A static example ships a real package.json (no @facilis.dev dependencies, no backend),
// so this one is not rebuilt from a full-stack shape: the example's dependency versions
// are kept and only the VM constraints are added — the npm the IDE vendors with its
// preinstall guard, the wasm32 bindings Vite 8 and Tailwind v4 need where
// process.arch is "wasm32" (DEV.md 6.1). Test/lint tooling stays out: the generated
// project is a site, not a workspace member.

import { frameworkPackagesVersion } from "@/deploy/current";
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

/**
 * The static project's package.json, from the example's own one.
 *
 * @param exampleSource the example's package.json; the source of every dependency version.
 */
export function staticPackageJson(exampleSource: string): string {
  const example = JSON.parse(exampleSource) as StaticPackage;
  const dependencies: Record<string, string> = {};
  for (const [name, spec] of Object.entries(example.dependencies ?? {})) {
    // A static template has no framework packages, but a future one might: keep the same
    // exact-version rule the full-stack template uses rather than a workspace spec (D-166).
    dependencies[name] = name.startsWith("@facilis.dev/") ? frameworkPackagesVersion : spec;
  }
  const devDependencies: Record<string, string> = {};
  for (const [name, spec] of Object.entries(example.devDependencies ?? {})) {
    if (EXAMPLE_ONLY_DEV_DEPENDENCIES.has(name) || spec === "catalog:") continue;
    devDependencies[name] = spec;
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
