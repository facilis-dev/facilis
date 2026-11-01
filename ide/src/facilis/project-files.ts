// IDE-specific wrappers around examples/todo-app, the single source of the generated
// project (D-062).
//
// The @facilis/* packages are workspace-only (O-006), so the generated project installs
// them from tarballs the IDE serves from its own public directory. npm is the installer
// and the tarballs are inlined INTO the create request (manifest.assets, project-assets.ts,
// D-032), then declared as file: dependencies: no package manager has to reach the studio
// over HTTP to install them, and the project keeps working once it leaves the IDE. This is
// interim until the packages are published.
//
// Everything else the project contains comes from examples/todo-app (example-template.ts);
// this file only writes what cannot: the npm wrapper, the standalone tsconfig and the
// scripts the VM needs.

import { renderProjectNpmrc } from "@/deploy/artifacts";
import { deployment, environmentVersion } from "@/deploy/current";
import type { ResolvedDeployment } from "@/deploy/types";
import { APP_MANIFEST_FILE, renderAppManifest } from "./app-manifest";
import { examplePackageJson } from "./example-template";

type ExamplePackage = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

/** The example's dependency versions, with workspace specs pointed at vendored tarballs. */
function packageJson(): string {
  const tarball = (name: string) => "file:./vendor/facilis-" + name + "-0.0.0.tgz";
  const example = JSON.parse(examplePackageJson()) as ExamplePackage;
  const dependencies: Record<string, string> = {};
  for (const [name, spec] of Object.entries(example.dependencies)) {
    dependencies[name] = name.startsWith("@facilis/") ? tarball(name.slice(9)) : spec;
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
  const devDependencies = {
    // The IDE feeds installed @types/*.d.ts files to Monaco's TypeScript service, so a
    // project without these reports TS2307 "Cannot find module 'react'" on src/app.tsx.
    "@types/react": example.devDependencies["@types/react"] ?? "19.3.0",
    "@types/react-dom": example.devDependencies["@types/react-dom"] ?? "19.3.0",
    "@rolldown/binding-wasm32-wasi": "~1.2.0",
    "@vitejs/plugin-react": example.devDependencies["@vitejs/plugin-react"] ?? "6.1.2",
    vite: example.devDependencies["vite"] ?? "8.3.5",
  };
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
        // (DEV.md 6.1). The @facilis packages need no override: they are file:
        // dependencies of the root, and npm satisfies the tarballs' 0.0.0 interdeps
        // from that same hoisted set instead of asking the registry.
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
// with, and the @facilis tarballs' interdeps assume the flat layout npm produces.
const agent = process.env.npm_config_user_agent ?? "";
if (!agent.startsWith("npm/")) {
  console.error("Use npm in this project — it is the package manager this project ships with.");
  console.error("  npm install   (then: npm run dev)");
  process.exit(1);
}
`;

const readme = `# facilis-app

A Facilis starter app scaffolded by the Facilis IDE and running in its browser VM.

It is the generated-project reference: auth + todos pages composed from @facilis/ui,
with the API, schema and i18n catalogues from examples/todo-app.

## Package manager

npm, with the @facilis/* packages installed from the tarballs in ./vendor:

    npm run dev

"npm run dev" expects dependencies to be installed: the IDE's Run installs them for
you, and scripts/vendor-paths.cjs is what makes that install resolve the
@facilis/* tarballs in ./vendor (run it before a bare npm install).

The preinstall guard rejects other package managers on purpose: the IDE vendors the
npm it was built and tested against, and keeps it aligned with its Node version.
`;

const vendorPathsScript = `// Resolve the @facilis/* tarballs to absolute file: paths before npm reads
// package.json.
//
// The @facilis/* packages come from tarballs in ./vendor (they are workspace-only until
// O-006). A RELATIVE file: spec is re-derived by npm — it recomputes the target with
// path.relative() and stores that as the dependency's resolved form — and inside the VM
// that derivation was measured producing /user/projects/... instead of
// /home/user/projects/...: the tarball then "does not exist", npm retries it as
// corrupted and the install dies with ENOENT. An absolute spec leaves npm nothing to
// re-derive, so this runs before every install (manifest.install). Idempotent, and it
// refuses a project whose template assets are missing instead of failing later.
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const file = path.join(root, "package.json");
const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
const deps = pkg.dependencies || {};
let changed = 0;
for (const name of Object.keys(deps)) {
  if (!name.startsWith("@facilis/")) continue;
  const tarball = path.join(root, "vendor", "facilis-" + name.slice(9) + "-0.0.0.tgz");
  if (!fs.existsSync(tarball)) {
    console.error("[facilis] missing " + tarball);
    console.error("[facilis] the project's template assets are incomplete — recreate it from the IDE");
    process.exit(1);
  }
  const spec = "file:" + tarball;
  if (deps[name] !== spec) {
    deps[name] = spec;
    changed++;
  }
}
if (changed > 0) {
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + "\\n");
  console.log("[facilis] resolved " + changed + " @facilis/* dependencies to absolute tarball paths");
}
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
    "scripts/vendor-paths.cjs": vendorPathsScript,
  };
}
