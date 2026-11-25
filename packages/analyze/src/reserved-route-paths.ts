/**
 * Framework-owned route paths (invariant 6, D-107/D-116/D-120, D-215).
 *
 * A project route file may not live under one of these paths: the framework registers its own
 * handler there in dev and production, so the app route would shadow it (or be shadowed), and
 * the control plane (manifest, health, dev consoles, telemetry), the SSO namespace and the
 * token endpoint must stay framework code.
 *
 * The list is derived from @facilis.dev/nitro's route constants
 * (`packages/nitro/src/constants.ts`) and the SSO namespace in `runtime/sso.ts`.
 * `@facilis.dev/nitro` depends on this package, so the analyzer cannot import it; the pinned
 * list is drift-guarded by `reserved-route-paths.test.ts`, which fails when a `*_ROUTE`
 * constant in that file is not covered here.
 *
 * Deliberately NOT reserved: `/api/files/**` and `/api/jobs/**`. @facilis.dev/storage's
 * signing helper only builds `/api/files/<id>` URLs and the shipped examples own both trees;
 * the framework registers no handler there, so reserving them would flag shipped apps
 * (recorded in D-215).
 */

/** One framework-owned path: an exact route or a path prefix (segment boundary included). */
export interface ReservedRoutePath {
  readonly path: string;
  readonly match: "exact" | "prefix";
  readonly why: string;
}

export const RESERVED_ROUTE_PATHS: readonly ReservedRoutePath[] = [
  {
    path: "/__facilis",
    match: "prefix",
    why: "the framework control plane (manifest, health, dev-only schema/query/view consoles, telemetry ingestion), registered by @facilis.dev/nitro in every environment (D-116/D-203)",
  },
  {
    path: "/_facilis/openapi.json",
    match: "exact",
    why: "Nitro's own OpenAPI document is kept intact at this dev-only internal path",
  },
  {
    path: "/_openapi.json",
    match: "exact",
    why: "the framework's OpenAPI facade route (packages/nitro/src/routes/openapi.get.ts)",
  },
  {
    path: "/api/auth/sso",
    match: "prefix",
    why: "the framework-owned SSO namespace (D-120): providers, start and callback/ACS are one handler, registered in dev and production",
  },
  {
    path: "/api/auth/token",
    match: "exact",
    why: "the framework-owned OAuth2 client-credentials token endpoint (D-142/D-143)",
  },
];

/**
 * Route-file directories owned by the framework, relative to the project root. The derived
 * route path already starts with `/__facilis`; this list keeps the file-location rule explicit
 * for a route file whose location the file router normalizes (a `(group)` segment).
 */
export const RESERVED_ROUTE_DIRS = ["server/routes/__facilis/", "server/api/__facilis/"] as const;

function normalizeRoutePath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function matches(entry: ReservedRoutePath, path: string): boolean {
  if (entry.match === "exact") return path === entry.path;
  // Segment boundary: "/__facilisx" is an application path, not the framework namespace.
  return path === entry.path || path.startsWith(entry.path + "/");
}

/** The framework-owned entry `path` shadows, or undefined when the route is the app's own. */
export function reservedRoutePathOf(path: string): ReservedRoutePath | undefined {
  const normalized = normalizeRoutePath(path);
  return RESERVED_ROUTE_PATHS.find((entry) => matches(entry, normalized));
}

/** True when a route file lives under a framework-owned route directory. */
export function isReservedRouteFile(sourceFile: string): boolean {
  const normalized = sourceFile.replace(/\\/g, "/").replace(/^\.\//, "");
  return RESERVED_ROUTE_DIRS.some(
    (dir) => normalized.startsWith(dir) || normalized.includes("/" + dir),
  );
}
