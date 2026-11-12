// The IDE-owned files every generated project gets, plus the assembly of a template from
// its example sources (D-062, D-168).
//
// A template ships sources it takes verbatim from an example (example-sources.ts) and this
// module adds only what the IDE can write: the admission marker, the generated
// package.json, the standalone tsconfig, the npm wrapper (.npmrc + scripts/check-pm.mjs)
// and the README. A full-stack template passes the fullstack wrappers, a static one its
// own — nothing in this module knows which template it is assembling.

import { renderProjectNpmrc } from "@/deploy/artifacts";
import { deployment, environmentVersion } from "@/deploy/current";
import type { ResolvedDeployment } from "@/deploy/types";
import { APP_MANIFEST_FILE, renderAppManifest } from "./app-manifest";
import type { ExampleSources, FacilisManifest } from "./template-types";
import type { ProjectTemplate } from "../vv/project-manifest";

/**
 * The npm the IDE vendors (scripts/dev/vendor-assets.sh): the version the VM runs and the
 * one this project was tested with (D-032).
 */
export const PROJECT_PACKAGE_MANAGER = "npm@12.2.1";

/** The wasm32 rolldown binding Vite 8 needs where process.arch is "wasm32" (DEV.md 6.1). */
export const ROLLDOWN_WASM_BINDING = "~1.2.0";

/** The verified interim pins Vite 8's wasi binding needs in the VM (DEV.md 6.1). */
export const VM_OVERRIDES: Readonly<Record<string, string>> = {
  "@emnapi/core": "2.0.0-beta.2",
  "@emnapi/runtime": "2.0.0-beta.2",
};

/**
 * Dev dependencies every generated project needs in the VM, whatever its template.
 *
 * @tailwindcss/oxide-wasm32-wasi is the Tailwind engine's wasm32 binding: the VM reports
 * process.arch "wasm32", so it resolves there, while on the host it is EBADPLATFORM and
 * must not leak into the example's own install. Pinning it to the same exact version as
 * tailwindcss keeps the engine and its binding in lockstep.
 */
export function vmDevDependencies(tailwindcss?: string): Record<string, string> {
  const devDependencies: Record<string, string> = {
    "@rolldown/binding-wasm32-wasi": ROLLDOWN_WASM_BINDING,
  };
  if (tailwindcss !== undefined) devDependencies["@tailwindcss/oxide-wasm32-wasi"] = tailwindcss;
  return devDependencies;
}

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

/** The standalone tsconfig a generated project gets (no extends: the repo base is not shipped). */
export function renderTsconfig(include: readonly string[]): string {
  return (
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2023",
          lib: ["ES2023", "DOM", "DOM.Iterable"],
          module: "ESNext",
          moduleResolution: "Bundler",
          jsx: "react-jsx",
          strict: true,
          skipLibCheck: true,
          noEmit: true,
          allowImportingTsExtensions: true,
          resolveJsonModule: true,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          types: ["vite/client"],
          paths: { "~/*": ["./*"] },
        },
        include,
      },
      null,
      2,
    ) + "\n"
  );
}

/** What each template owns of the IDE-written tree. */
export interface TemplateWrappers {
  /** Build the generated package.json from the example's. */
  packageJson: (examplePackageJson: string) => string;
  /** README body for the generated project. */
  readme: string;
  /** tsconfig `include` for the generated project. */
  tsconfigInclude: readonly string[];
}

/** The concrete IDE-owned file bodies for one generated project. */
export interface ProjectFileBodies {
  packageJson: string;
  readme: string;
  tsconfigInclude: readonly string[];
}

/** A template assembly: its manifest, its example sources and the wrappers the IDE owns. */
export interface TemplateAssembly {
  manifest: FacilisManifest;
  example: ExampleSources;
  wrappers: TemplateWrappers;
  /** Files that replace example paths the IDE owns (the todo template's smoke hooks). */
  overrides?: Record<string, string>;
}

/**
 * The generated project, from the template plus what only the IDE can write.
 *
 * `d` is the deployment profile because the npm wrapper carries the deployment's package
 * policy: the IDE runs the same sources for every profile, so the generated `.npmrc` (not
 * the IDE build) is where a managed project learns which registry it may reach.
 */
export function projectFileTemplates(
  d: ResolvedDeployment,
  version: string,
  files: ProjectFileBodies,
): Record<string, string> {
  return {
    [APP_MANIFEST_FILE]: renderAppManifest(version),
    "package.json": files.packageJson,
    "tsconfig.json": renderTsconfig(files.tsconfigInclude),
    // npm flags that matter inside the VM: audit and update-notifier are registry
    // calls nobody asked for in this container, progress is what the IDE mirrors into
    // the browser. Everything else is npm's default — a flat (hoisted) node_modules,
    // which is what the bundled Nitro dist's undeclared transitive requires rely on.
    // renderProjectNpmrc keeps those flags and adds `registry=<mirror>` when the
    // deployment has one.
    ".npmrc": renderProjectNpmrc(d),
    "README.md": files.readme,
    "scripts/check-pm.mjs": checkPm,
  };
}

/** Assemble one template: example sources first, then the IDE-owned files and overrides. */
export function assembleTemplate(
  assembly: TemplateAssembly,
  d: ResolvedDeployment = deployment,
  version: string = environmentVersion,
): ProjectTemplate {
  return {
    manifest: assembly.manifest,
    files: {
      ...assembly.example.files,
      ...projectFileTemplates(d, version, {
        packageJson: assembly.wrappers.packageJson(assembly.example.packageJson),
        readme: assembly.wrappers.readme,
        tsconfigInclude: assembly.wrappers.tsconfigInclude,
      }),
      ...assembly.overrides,
    },
  };
}
