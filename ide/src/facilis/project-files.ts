// Project-level files of the Facilis probe template (SPEC Appendix B/C).
//
// The @facilis/* packages are workspace-only (O-006), so the generated project
// installs them from tarballs the IDE serves from its own public directory. npm is
// the installer and the tarballs are copied INTO the project (manifest.assets, see
// D-032), then declared as file: dependencies: no package manager has to reach the
// studio over HTTP to install them, and the project keeps working once it leaves the
// IDE. This is interim until the packages are published.

/** package.json for the probe app. */
function packageJson(): string {
  const tarball = (name: string) => "file:./vendor/facilis-" + name + "-0.0.0.tgz";
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
        dependencies: {
          "@electric-sql/pglite": "0.5.11",
          "@facilis/auth": tarball("auth"),
          "@facilis/core": tarball("core"),
          "@facilis/db": tarball("db"),
          "@facilis/nitro": tarball("nitro"),
          "drizzle-orm": "0.45.4",
          nitro: "3.0.260903-beta",
          // Nitro 3.0.260903-beta imports a dozen packages it lists only in its
          // devDependencies — but it also vendors pruned copies of them under
          // dist/node_modules, so the runtime's missing-target fallback (fork PR #19,
          // D-024) loads their ESM builds and the project no longer declares them. The
          // two it does not vendor stay pinned: picomatch is __require'd by nitro's
          // builder at run time, @vercel/queue only by the Vercel Queues preset.
          picomatch: "^4.0.3",
          "@vercel/queue": "^0.5.1",
          react: "19.3.1",
          "react-dom": "19.3.1",
          rolldown: "1.2.15",
          zod: "4.6.7",
        },
        devDependencies: {
          "@rolldown/binding-wasm32-wasi": "~1.2.0",
          "@vitejs/plugin-react": "6.1.2",
          vite: "8.3.5",
        },
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

const viteConfig = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { facilis } from "@facilis/nitro/vite";

// One dev server: Vite serves the client and Nitro runs as a plugin on the same
// origin (SPEC 10.6). facilis() comes before nitro() so the Facilis Nitro module
// is attached to the plugin chain before Nitro boots.
export default defineConfig({
  plugins: [facilis(), nitro(), react()],
  resolve: {
    alias: { "~": new URL(".", import.meta.url).pathname },
  },
});
`;

const nitroConfig = `import { defineConfig } from "nitro";

export default defineConfig({
  // Nitro v3 does not scan directories unless serverDir is set (SPEC 4.2 note).
  serverDir: "./server",
  experimental: { openAPI: true },
  // The default node-worker dev runner cannot start inside the WebContainer:
  // it needs worker_threads and resolves its entry through import.meta.resolve,
  // which the VM runtime does not provide as a file URL. The in-process runner
  // keeps the Nitro environment in the Vite dev-server process.
  devServer: { runner: "self" },
});
`;

const facilisConfig = `import { defineConfig } from "@facilis/core";

export default defineConfig({
  release: { ref: "main" },
  db: { mode: "pglite", migrationsDir: "db/migrations" },
  i18n: { defaultLocale: "en", locales: ["en"] },
  blocks: { packages: [] },
  auth: {
    permissions: ["todos:read", "todos:write"],
    roles: { admin: ["*"], user: ["todos:read"] },
    defaultRole: "user",
  },
});
`;

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
    "types": ["vite/client"],
    "paths": { "~/*": ["./*"] }
  },
  "include": ["src", "server", "db", "vite.config.ts", "nitro.config.ts", "facilis.config.ts"]
}
`;

const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Facilis</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

// npm flags that matter inside the VM: audit and update-notifier are registry calls
// nobody asked for in this container, fund and progress are terminal noise the IDE
// mirrors into the browser. Everything else is npm's default — a flat (hoisted)
// node_modules, which is what the bundled Nitro dist's undeclared transitive
// requires (ufo, …) rely on.
const npmrc = `audit=false
fund=false
progress=false
update-notifier=false
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

A Facilis project scaffolded by the Facilis IDE and running in its browser VM.

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
// The four @facilis/* packages come from tarballs in ./vendor (they are workspace-only
// until O-006). A RELATIVE file: spec is re-derived by npm — it recomputes the target
// with path.relative() and stores that as the dependency's resolved form — and inside
// the VM that derivation was measured producing /user/projects/... instead of
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

export function projectFiles(): Record<string, string> {
  return {
    "package.json": packageJson(),
    "index.html": indexHtml,
    "tsconfig.json": tsconfig,
    "vite.config.ts": viteConfig,
    "nitro.config.ts": nitroConfig,
    "facilis.config.ts": facilisConfig,
    ".npmrc": npmrc,
    "README.md": readme,
    "scripts/check-pm.mjs": checkPm,
    "scripts/vendor-paths.cjs": vendorPathsScript,
  };
}
