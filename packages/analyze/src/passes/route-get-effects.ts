/**
 * GET side-effect check (SPEC §8.6, D-212): a GET route must be side-effect free.
 *
 * SameSite=Lax sends the session cookie on a cross-site top-level GET navigation, so a
 * state-changing GET is CSRF-able even with the origin gate (which covers unsafe methods
 * only). The facts come from the route-relations walk (D-157): insert/update/delete sites,
 * db.execute sites and job-queue mutations, following project-local helper calls. A write
 * the walk can prove is an error; a body it cannot fully inspect is a warning, never a
 * guessed error. Pinned exemptions: the framework protocol write GETs (SSO, email
 * verification) and the framework read-only blueprint GETs (separate lists, D-212).
 */

import { error, warning } from "../diagnostics.ts";
import type { Diagnostic, HttpMethod, RouteFact, SourceRef } from "../types.ts";

/**
 * Pinned framework exemptions (D-212): a framework GET that legitimately writes, with the
 * one-line why. An entry matches an exact path or a path prefix; application routes must not
 * add another write path under them.
 */
export const FRAMEWORK_GET_WRITE_EXEMPTIONS: readonly {
  readonly path?: string;
  readonly pathPrefix?: string;
  readonly why: string;
}[] = [
  {
    pathPrefix: "/api/auth/sso/",
    why: "D-120: the SSO start/callback GETs are the protocol's own write path (single-use state creation and login completion); the SAML ACS is a POST.",
  },
  {
    // Exact path, not a prefix: "/api/auth/verify-email-other" is an app route, not the link.
    path: "/api/auth/verify-email",
    why: "D-156: the single-use email-verification link is consumed before a session exists; the token is the credential (protocol-driven, like SSO).",
  },
];

/**
 * Pinned framework READ-ONLY blueprint exemptions (D-212), kept separate from the write
 * list: framework-guaranteed read-only surfaces whose bodies are opaque to the walk (a
 * framework primitive receives the client). Exact paths only — a neighbouring app path is
 * not the blueprint. The shipped apps boot with zero analyzer warnings (D-199 precedent).
 */
export const FRAMEWORK_GET_READ_EXEMPTIONS: readonly {
  readonly path: string;
  readonly why: string;
}[] = [
  {
    path: "/api/auth/clients",
    why: "D-142/D-156 blueprint: listApiClients is a read-only projection (the secret hash never leaves the server); the starter contract pins the route.",
  },
  {
    path: "/api/files/{id}",
    why: "D-053 blueprint: sendStoredFile verifies the signed token and streams the blob, no write; the starter contract pins the route.",
  },
];

export const GET_SIDE_EFFECT_CODE = "route-get-side-effect";

const WRITE_MESSAGE =
  "GET routes must be side-effect free (SPEC §8.6): a state-changing GET is CSRF-able via cross-site top-level navigation (SameSite=Lax). Move the write to a POST/PUT/PATCH/DELETE route.";
const UNKNOWN_MESSAGE =
  "The GET handler's side effects cannot be fully inspected (opaque body); confirm the route is read-only (SPEC §8.6).";

/** GET, and a method-less (ALL) route, which serves GET too. HEAD is not a navigation vector. */
export function isGetLikeMethod(method: HttpMethod): boolean {
  return method === "GET" || method === "ALL";
}

export function isFrameworkGetExempt(route: Pick<RouteFact, "path">): boolean {
  // Write list: protocol-driven write paths (exact path or prefix).
  const write = FRAMEWORK_GET_WRITE_EXEMPTIONS.some(
    (entry) =>
      (entry.path !== undefined && route.path === entry.path) ||
      (entry.pathPrefix !== undefined && route.path.startsWith(entry.pathPrefix)),
  );
  if (write) return true;
  // Read list: framework-guaranteed read-only blueprint surfaces, exact path only.
  return FRAMEWORK_GET_READ_EXEMPTIONS.some((entry) => route.path === entry.path);
}

export interface GetSideEffects {
  /** Proven side-effect sites (writes, raw execute, queue mutations), in source order. */
  readonly writes: readonly SourceRef[];
  /** The handler reaches a callee the walk cannot inspect, so absence of writes is unproven. */
  readonly unknown: boolean;
  readonly exempt: boolean;
}

/**
 * Side-effect facts of one route, read from its relations fact (overlay-safe: pre-D-212
 * snapshots lack the new fields, hence the fallbacks). Shared with AI validator rule 21.
 */
export function routeGetSideEffects(route: RouteFact): GetSideEffects {
  const usage = route.relations;
  const elevations = usage.elevations ?? [];
  const writes: SourceRef[] = [
    ...(usage.writes ?? []),
    ...(usage.rawSql ?? []),
    ...(usage.jobEnqueues ?? []),
  ];
  for (const elevation of elevations) writes.push(...(elevation.writes ?? []));
  writes.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
  const unknown = usage.opaque || elevations.some((elevation) => elevation.opaque);
  return { writes, unknown, exempt: isFrameworkGetExempt(route) };
}

/** Diagnostics for every GET-like route with a valid wrapper (SPEC §8.6, D-212). */
export function routeGetEffectDiagnostics(routes: readonly RouteFact[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const route of routes) {
    if (!isGetLikeMethod(route.method) || route.wrapper !== "valid") continue;
    const { writes, unknown, exempt } = routeGetSideEffects(route);
    if (exempt) continue;
    if (writes.length > 0) {
      for (const site of writes) diagnostics.push(error(GET_SIDE_EFFECT_CODE, WRITE_MESSAGE, site));
    } else if (unknown) {
      diagnostics.push(warning(GET_SIDE_EFFECT_CODE, UNKNOWN_MESSAGE, route.source));
    }
  }
  return diagnostics;
}
