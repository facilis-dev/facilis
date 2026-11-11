// IDE-specific wrappers around examples/todo-app, the single source of the generated
// project (D-062).
//
// The @facilis.dev/* framework packages install from the public npm registry at the exact
// version this build pins (frameworkPackagesVersion, D-166). They are ordinary published
// dependencies, not file: tarballs: the generated project keeps working once it leaves the
// IDE, and there is nothing binary to ship beside the sources. The v1 UI kit was removed
// (D-096): template v2 copies its primitives into src/components/ui.
//
// Everything else the project contains comes from examples/todo-app (example-template.ts);
// this file only writes what cannot: the npm wrapper, the standalone tsconfig and the
// scripts the VM needs.

import { renderProjectNpmrc } from "@/deploy/artifacts";
import { deployment, environmentVersion, frameworkPackagesVersion } from "@/deploy/current";
import type { ResolvedDeployment } from "@/deploy/types";
import { APP_MANIFEST_FILE, renderAppManifest } from "./app-manifest";
import { examplePackageJson } from "./example-template";

type ExamplePackage = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

/** The example's dependency versions, with workspace specs pinned to the published version. */
function packageJson(): string {
  const example = JSON.parse(examplePackageJson()) as ExamplePackage;
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
  const devDependencies: Record<string, string> = {
    // The IDE feeds installed @types/*.d.ts files to Monaco's TypeScript service, so a
    // project without these reports TS2307 "Cannot find module 'react'" on src/app.tsx.
    "@types/react": example.devDependencies["@types/react"] ?? "19.3.0",
    "@types/react-dom": example.devDependencies["@types/react-dom"] ?? "19.3.0",
    "@rolldown/binding-wasm32-wasi": "~1.2.0",
    "@vitejs/plugin-react": example.devDependencies["@vitejs/plugin-react"] ?? "6.1.2",
    vite: example.devDependencies["vite"] ?? "8.3.5",
  };
  // Tailwind CSS v4 is the v2 template's styling layer, but its toolchain is a VM-only
  // addition and must not leak into the example: @tailwindcss/oxide-wasm32-wasi is the
  // Tailwind engine's wasm32 binding. The VM reports process.arch "wasm32", so that
  // optional dependency resolves normally there, while on the host the package is
  // EBADPLATFORM and would break the example's install. Pinning it to the same exact
  // version as tailwindcss keeps the engine and its binding in lockstep. A v1 project has
  // no tailwindcss dependency, so it gets none of the three.
  const tailwindcss = example.devDependencies["tailwindcss"];
  if (tailwindcss !== undefined) {
    devDependencies["tailwindcss"] = tailwindcss;
    devDependencies["@tailwindcss/vite"] = example.devDependencies["@tailwindcss/vite"] ?? "4.3.5";
    devDependencies["@tailwindcss/oxide-wasm32-wasi"] = tailwindcss;
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
        packageManager: "npm@12.2.1",
        scripts: {
          dev: "vite",
          build: "vite build",
          preview: "vite preview",
          preinstall: "node scripts/check-pm.mjs",
        },
        dependencies,
        devDependencies,
        // The emnapi pins are the verified interim fix for Vite 8's wasi binding
        // (DEV.md 6.1). The @facilis.dev packages need no override: they are published
        // dependencies at one exact version, so npm resolves their interdeps from the
        // registry like any other package.
        overrides: {
          "@emnapi/core": "2.0.0-beta.2",
          "@emnapi/runtime": "2.0.0-beta.2",
        },
      },
      null,
      2,
    ) + "\n"
  );
}

const tsconfig = `{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "types": ["vite/client"],
    "paths": { "~/*": ["./*"] }
  },
  "include": ["src", "server", "db", "vite.config.ts", "facilis.config.ts"]
}
`;

const checkPm = `// Runs as the project preinstall hook: the project must be installed with npm.
// The IDE vendors exactly one package manager and keeps it aligned with the VM's
// Node (D-032); any other one on PATH would build a tree nothing here was tested
// with, and the @facilis.dev packages assume the flat layout npm produces.
const agent = process.env.npm_config_user_agent ?? "";
if (!agent.startsWith("npm/")) {
  console.error("Use npm in this project — it is the package manager this project ships with.");
  console.error("  npm install   (then: npm run dev)");
  process.exit(1);
}
`;

const readme = `# facilis-app

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
 * The generated project, from the template plus what only the IDE can write.
 *
 * `d` is the deployment profile because the npm wrapper carries the deployment's
 * package policy: the IDE runs the same sources for every profile, so the
 * generated `.npmrc` (not the IDE build) is where a managed project learns which
 * registry it may reach. Defaults to the compiled profile; tests pass a fixture.
 */
export function projectFiles(
  d: ResolvedDeployment = deployment,
  version: string = environmentVersion,
): Record<string, string> {
  return {
    [APP_MANIFEST_FILE]: renderAppManifest(version),
    "package.json": packageJson(),
    "tsconfig.json": tsconfig,
    // npm flags that matter inside the VM: audit and update-notifier are registry
    // calls nobody asked for in this container, fund and progress are terminal
    // noise the IDE mirrors into the browser. Everything else is npm's default — a
    // flat (hoisted) node_modules, which is what the bundled Nitro dist's
    // undeclared transitive requires (ufo, …) rely on. renderProjectNpmrc keeps
    // those flags and adds `registry=<mirror>` when the deployment has one.
    ".npmrc": renderProjectNpmrc(d),
    "README.md": readme,
    "scripts/check-pm.mjs": checkPm,
  };
}
