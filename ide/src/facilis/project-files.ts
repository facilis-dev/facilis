// Project-level files of the Facilis probe template (SPEC Appendix B/C).
//
// The @facilis/* packages are workspace-only (O-006), so the generated project
// installs them from tarballs the IDE serves from its own public directory, addressed
// through the kernel host alias (a raw loopback URL is the VM itself). pnpm is the
// installer; see D-022 for why npm cannot do it and why the layout must be hoisted.

/** package.json for the probe app. */
function packageJson(origin: string): string {
  const tarball = (name: string) => origin + "/vendor/facilis/facilis-" + name + "-0.0.0.tgz";
  return (
    JSON.stringify(
      {
        name: "facilis-app",
        private: true,
        version: "0.0.0",
        type: "module",
        packageManager: "pnpm@9.15.9",
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
          // Nitro 3.0.260903-beta ships a dist that imports these at runtime but lists
          // them only in its devDependencies. The in-VM config loader executes that dist
          // with a plain ESM loader (Vite's config bundler cannot run in the WebContainer),
          // so every one of them must be a real dependency here or the dev server dies on
          // the first missing module. Versions follow nitro's devDependencies; picomatch
          // is undeclared there and comes transitively, so it is pinned explicitly.
          "@poppinss/colors": "^4.1.6",
          "@poppinss/dumper": "^0.7.0",
          "@speed-highlight/core": "^1.2.14",
          "@vercel/queue": "^0.5.1",
          "youch-core": "^0.3.3",
          "cookie-es": "^3.1.1",
          croner: "^10.0.1",
          defu: "^6.1.7",
          destr: "^2.0.5",
          picomatch: "^4.0.3",
          rendu: "^0.1.0",
          scule: "^1.3.0",
          ufo: "^1.6.4",
          unctx: "^3.0.1",
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
        // (DEV.md 6.1). The @facilis entries stop the package manager from walking
        // back to the registry for the packed interdeps. npm reads "overrides";
        // pnpm reads "pnpm.overrides" and ignores this field, so both are declared.
        overrides: {
          "@emnapi/core": "2.0.0-beta.2",
          "@emnapi/runtime": "2.0.0-beta.2",
          "@facilis/auth": tarball("auth"),
          "@facilis/core": tarball("core"),
          "@facilis/db": tarball("db"),
          "@facilis/nitro": tarball("nitro"),
        },
        // pnpm is the in-VM installer: npm's agent-base HTTP agent makes the kernel
        // runtime treat plain-http URL deps as non-egress and fail with ENOTFOUND,
        // while pnpm's fetch uses the standard agent and reaches the host alias.
        pnpm: {
          overrides: {
            "@emnapi/core": "2.0.0-beta.2",
            "@emnapi/runtime": "2.0.0-beta.2",
            "@facilis/auth": tarball("auth"),
            "@facilis/core": tarball("core"),
            "@facilis/db": tarball("db"),
            "@facilis/nitro": tarball("nitro"),
          },
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

// pnpm is the only installer that works inside the WebContainer:
// - node-linker=hoisted because the bundled Nitro runtime does require("ufo"), a
//   transitive dependency it does not declare; the isolated linker hides it.
// - the preinstall guard blocks npm, whose agent-base HTTP agent makes the kernel
//   runtime refuse plain-http egress, so the @facilis tarball URLs cannot be fetched.
const npmrc = `node-linker=hoisted
`;

const checkPm = `// Runs as the project preinstall hook: the project must be installed with pnpm.
// npm 10 agent-base HTTP agent bypasses the WebContainer fetch-backed egress,
// so its plain-http URL dependencies (the @facilis tarballs) fail with ENOTFOUND.
const agent = process.env.npm_config_user_agent ?? "";
if (!agent.startsWith("pnpm/")) {
  console.error("Use pnpm in this project: npm cannot fetch its URL dependencies in the VM.");
  console.error("  pnpm install   (then: pnpm run dev)");
  process.exit(1);
}
`;

const readme = `# facilis-app

A Facilis project scaffolded by the Facilis IDE and running in its browser VM.

## Package manager

Use pnpm — it is the only installer that works in this VM:

    pnpm install
    pnpm run dev -- --configLoader native

npm install fails here on purpose: the npm HTTP agent bypasses the VM
fetch-backed egress, so the @facilis/* tarball dependencies cannot be downloaded
(ENOTFOUND). The preinstall guard enforces this.
`;

export function projectFiles(origin: string): Record<string, string> {
  return {
    "package.json": packageJson(origin),
    "index.html": indexHtml,
    "tsconfig.json": tsconfig,
    "vite.config.ts": viteConfig,
    "nitro.config.ts": nitroConfig,
    "facilis.config.ts": facilisConfig,
    ".npmrc": npmrc,
    "README.md": readme,
    "scripts/check-pm.mjs": checkPm,
  };
}
