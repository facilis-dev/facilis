// The wrappers of the full-stack template (Nitro + PGlite + React): the generated
// package.json, its tsconfig include and its README.
//
// The @facilis.dev/* framework packages install from the public npm registry at the exact
// version this build pins (frameworkPackagesVersion, D-166). They are ordinary published
// dependencies, not file: tarballs: the generated project keeps working once it leaves the
// IDE, and there is nothing binary to ship beside the sources. The v1 UI kit was removed
// (D-096): template v2 copies its primitives into src/components/ui.
//
// Everything else the project contains comes from examples/todo-app (example-template.ts);
// this file only writes what cannot: the npm wrapper package.json and the standalone README.

import { frameworkPackagesVersion } from "@/deploy/current";
import { examplePackageJson } from "./example-template";
import { PROJECT_PACKAGE_MANAGER, VM_OVERRIDES, vmDevDependencies } from "./template-files";

type ExamplePackage = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

/** Paths the full-stack project typechecks: the client, the server, the schema and its configs. */
export const FULLSTACK_TSCONFIG_INCLUDE = [
  "src",
  "server",
  "db",
  "vite.config.ts",
  "facilis.config.ts",
] as const;

export const FULLSTACK_README = `# facilis-app

A Facilis starter app scaffolded by the Facilis IDE and running in its browser VM.

It is the generated-project reference: auth + todos pages built on Tailwind CSS v4 and
Base UI, with shadcn-style components copied into src/components/ui, plus the API, schema
and i18n catalogues from examples/todo-app. There is no UI kit package: the components live
in the project.

## Package manager

npm. The @facilis.dev/* packages install from the npm registry, pinned to one
exact published version:

    npm run dev

"npm run dev" expects dependencies to be installed: the IDE's Run installs them for
you, or run "npm install" yourself before it.

The preinstall guard rejects other package managers on purpose: the IDE vendors the
npm it was built and tested against, and keeps it aligned with its Node version.
`;

/**
 * The full-stack project's package.json, from the example's dependency versions.
 *
 * @param exampleSource the example's package.json; defaults to examples/todo-app's.
 */
export function fullstackPackageJson(exampleSource: string = examplePackageJson()): string {
  const example = JSON.parse(exampleSource) as ExamplePackage;
  const dependencies: Record<string, string> = {};
  for (const [name, spec] of Object.entries(example.dependencies)) {
    // Exact, never a range: the deploy pipeline injects the published version this IDE was
    // built against, and the framework packages move in lockstep with it (D-166).
    dependencies[name] = name.startsWith("@facilis.dev/") ? frameworkPackagesVersion : spec;
  }
  // Nitro 3.0.260903-beta imports a dozen packages it lists only in its devDependencies —
  // but it also vendors pruned copies of them under dist/node_modules, so the runtime's
  // missing-target fallback (fork PR #19, D-024) loads their ESM builds and the project no
  // longer declares them. These three it does not vendor: picomatch is __require'd by
  // nitro's builder at run time, @vercel/queue only by the Vercel Queues preset, and
  // rolldown is the bundler Vite 8 runs in the VM.
  const extras: Record<string, string> = {
    picomatch: "^4.0.3",
    "@vercel/queue": "^0.5.1",
    rolldown: "1.2.15",
  };
  for (const [name, spec] of Object.entries(extras)) {
    if (dependencies[name] === undefined) dependencies[name] = spec;
  }
  const tailwindcss = example.devDependencies["tailwindcss"];
  const devDependencies: Record<string, string> = {
    // The IDE feeds installed @types/*.d.ts files to Monaco's TypeScript service, so a
    // project without these reports TS2307 "Cannot find module 'react'" on src/app.tsx.
    "@types/react": example.devDependencies["@types/react"] ?? "19.3.0",
    "@types/react-dom": example.devDependencies["@types/react-dom"] ?? "19.3.0",
    ...vmDevDependencies(tailwindcss),
    "@vitejs/plugin-react": example.devDependencies["@vitejs/plugin-react"] ?? "6.1.2",
    vite: example.devDependencies["vite"] ?? "8.3.5",
  };
  // Tailwind CSS v4 is the v2 template's styling layer, but its toolchain is a VM-only
  // addition and must not leak into the example: the oxide wasm32 binding is added by
  // vmDevDependencies for exactly that reason. A v1 project has no tailwindcss
  // dependency, so it gets none of the three.
  if (tailwindcss !== undefined) {
    devDependencies["tailwindcss"] = tailwindcss;
    devDependencies["@tailwindcss/vite"] = example.devDependencies["@tailwindcss/vite"] ?? "4.3.5";
  }
  return (
    JSON.stringify(
      {
        name: "facilis-app",
        private: true,
        version: "0.0.0",
        type: "module",
        // Kept in lockstep with the vendored npm (scripts/dev/vendor-assets.sh):
        // it is the version the VM actually runs, and the one Node 24 is paired
        // with. See D-032.
        packageManager: PROJECT_PACKAGE_MANAGER,
        scripts: {
          dev: "vite",
          build: "vite build",
          preview: "vite preview",
          preinstall: "node scripts/check-pm.mjs",
        },
        dependencies,
        devDependencies,
        // The @facilis.dev packages need no override: they are published dependencies at
        // one exact version, so npm resolves their interdeps from the registry like any
        // other package.
        overrides: VM_OVERRIDES,
      },
      null,
      2,
    ) + "\n"
  );
}
