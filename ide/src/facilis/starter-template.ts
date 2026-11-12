// The empty full-stack template (D-168): standard login management and nothing else.
//
// The generated project IS examples/starter-app: a React 19 client with login, registration
// and a signed-in dashboard, the Nitro server routes for that auth surface, and the PGlite
// schema/migrations for the auth tables. The example is inlined as raw text at IDE build
// time, so the template and the example cannot drift; this module adds only the run
// manifest, the shared full-stack wrappers (generated package.json, tsconfig, README) and
// the one VM-only edit the example deliberately does not carry (the in-process Nitro
// runner and the "main" release ref).
//
// It is not the todo app: the example ships no todo page, route, table or job, so a project
// created from it starts from an authenticated shell instead of a demo to delete.

import type { ProjectTemplate } from "../vv/project-manifest";
import { exampleSources } from "./example-sources";
import { FULLSTACK_TSCONFIG_INCLUDE, fullstackPackageJson } from "./fullstack-files";
import { addVmNitro } from "./template-overrides";
import { assembleTemplate } from "./template-files";
import type { FacilisManifest } from "./template-types";

const EXAMPLE_DIR = "examples/starter-app/";

const rawSources = import.meta.glob<string>(
  [
    "../../../examples/starter-app/src/**/*.{ts,tsx,css}",
    "!../../../examples/starter-app/src/**/*.test.*",
    "../../../examples/starter-app/server/**/*.ts",
    "!../../../examples/starter-app/server/**/*.test.*",
    "../../../examples/starter-app/db/**/*",
    "!../../../examples/starter-app/db/**/*.test.*",
    "../../../examples/starter-app/locales/*.json",
    "../../../examples/starter-app/index.html",
    "../../../examples/starter-app/.gitignore",
    "../../../examples/starter-app/vite.config.ts",
    "../../../examples/starter-app/facilis.config.ts",
    "../../../examples/starter-app/package.json",
  ],
  { query: "?raw", import: "default", eager: true },
);

export const STARTER_README = `# facilis-app

A Facilis starter app scaffolded by the Facilis IDE: Nitro + PGlite + React with the
standard login surface already wired (login, registration, session, logout) and nothing
else. There is no demo page, table or job to delete — the authenticated dashboard is the
place to start building.

## Package manager

npm. The @facilis.dev/* packages install from the npm registry, pinned to one
exact published version:

    npm run dev

"npm run dev" expects dependencies to be installed: the IDE's Run installs them for
you, or run "npm install" yourself before it.

The preinstall guard rejects other package managers on purpose: the IDE vendors the
npm it was built and tested against, and keeps it aligned with its Node version.
`;

/** Build the empty full-stack template. */
export function createStarterTemplate(): ProjectTemplate {
  const example = exampleSources(rawSources, EXAMPLE_DIR);
  const config = example.files["facilis.config.ts"];
  if (config === undefined) {
    throw new Error("template: " + EXAMPLE_DIR + " has no facilis.config.ts");
  }
  // Same run manifest shape as the todo template: one Nitro-owned listener on port 3000
  // (the in-VM runner fronts Vite) and the same config-loader flag the VM needs.
  const manifest: FacilisManifest = {
    id: "facilis-starter",
    name: "Facilis starter",
    entry: "src/app.tsx",
    hmr: true,
    reload: false,
    install: "npm install",
    port: 3000,
    dev: "npm run dev -- --configLoader native",
    assets: [],
  };
  return assembleTemplate({
    manifest,
    example,
    wrappers: {
      packageJson: fullstackPackageJson,
      readme: STARTER_README,
      tsconfigInclude: FULLSTACK_TSCONFIG_INCLUDE,
    },
    overrides: { "facilis.config.ts": addVmNitro(config, EXAMPLE_DIR) },
  });
}
