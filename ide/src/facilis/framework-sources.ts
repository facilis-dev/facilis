// Framework state tables (users, sessions, roles, role_permissions, user_roles,
// auth_identities, auth_sso_states, facilis_files, facilis_jobs) are declared inside the
// installed @facilis/auth and @facilis/db packages, and a project only re-exports them from
// db/schema.ts (D-092). The IDE's VFS snapshot index skips node_modules by design
// (workspace-index.ts), so the browser analyzer never receives those declarations and
// silently drops every re-exported table from the project graph.
//
// Inline the two packages' source at IDE build time, exactly as example-template.ts does for
// the starter app. The vendored tarballs ship this same source (D-030), so this is what a
// project actually installs; inlining keeps the analysis free of extra VFS I/O and makes the
// graph correct before (and without) a successful npm install.

/**
 * The template packages that declare `pgTable` today, in template order.
 *
 * Only these two of TEMPLATE_PACKAGES carry framework tables. i18n-db also declares one,
 * but the template does not install it, so its tables are not framework state here.
 */
export const FRAMEWORK_TABLE_PACKAGES: readonly string[] = ["auth", "db"];

// Glob keys are relative to this module; the analyzer sees the packages under node_modules.
const PACKAGES_DIR = "packages/";
const PACKAGE_PATH = new RegExp(PACKAGES_DIR.replace(/\//g, "\\/"));

const rawSources = import.meta.glob<string>(
  [
    "../../../packages/auth/src/**/*.ts",
    "!../../../packages/auth/src/**/*.test.ts",
    "!../../../packages/auth/src/**/*.spec.ts",
    "../../../packages/auth/package.json",
    "../../../packages/db/src/**/*.ts",
    "!../../../packages/db/src/**/*.test.ts",
    "!../../../packages/db/src/**/*.spec.ts",
    "../../../packages/db/package.json",
  ],
  { query: "?raw", import: "default", eager: true },
);

/** Project-relative analyzer path of a glob key, or null when it is not a package file. */
function projectPath(key: string): string | null {
  const at = key.search(PACKAGE_PATH);
  if (at === -1) return null;
  const rest = key.slice(at + PACKAGES_DIR.length);
  return rest.length === 0 ? null : "node_modules/@facilis/" + rest;
}

/**
 * Every framework source an analysis needs, keyed by its path in an installed project
 * (`node_modules/@facilis/<pkg>/...`). Sorted so the analyzer's file map is deterministic
 * across glob orderings; package.json is included because module resolution reads its
 * `exports` to find `src/index.ts`.
 */
export function frameworkProjectFiles(): ReadonlyMap<string, string> {
  const files: (readonly [string, string])[] = [];
  for (const [key, source] of Object.entries(rawSources)) {
    const path = projectPath(key);
    if (path !== null) files.push([path, source]);
  }
  files.sort(([left], [right]) => left.localeCompare(right));
  return new Map(files);
}
