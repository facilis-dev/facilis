import { z } from "zod";

/**
 * Route-level prerendering declaration (D-202, SPEC §7.1), split from `config.ts` to keep
 * each module under the 300-line limit.
 *
 * Opt-in allowlist of public/static page routes: only declared routes are prerendered, and a
 * declared-but-ineligible route fails the build (the analyzer owns eligibility, D-092). The
 * default `{ routes: [] }` means prerendering is off.
 */

/** Prerendering defaults: no route is prerendered unless the project declares it. */
export const DEFAULT_PRERENDER_CONFIG: FacilisPrerenderConfig = Object.freeze({ routes: [] });

export interface FacilisPrerenderConfig {
  /** Absolute, param-free page paths from the one route table (D-058). */
  readonly routes: readonly string[];
  /** Absolute http(s) origin; enables canonical links + sitemap.xml (D-202 §6). */
  readonly origin?: string;
}

/** Authored form of the prerender section: every key has a documented default. */
export interface FacilisPrerenderConfigInput {
  readonly routes?: readonly string[];
  readonly origin?: string;
}

export const facilisPrerenderConfigSchema = z
  .strictObject({
    routes: z.array(z.string().min(1)).default([]),
    origin: z.string().optional(),
  })
  // The default is a fresh mutable literal (the dbSchema/i18nSchema precedent): zod's output
  // type is mutable, while the exported constant stays readonly for consumers.
  .default(() => ({ routes: [] }));

type ConfigPath = readonly (string | number)[];

function addIssue(ctx: z.RefinementCtx, path: ConfigPath, message: string): void {
  ctx.addIssue({ code: "custom", message, path: [...path] });
}

/**
 * Why a declared route is not a prerenderable page path, or null when it is well-formed.
 * Eligibility (guards, public APIs) is the analyzer's fail-closed fact, not a config rule.
 */
function routeShapeIssue(route: string): string | null {
  if (!route.startsWith("/")) return `prerender route "${route}" must start with "/"`;
  if (/[?#\s\\]/.test(route)) {
    return `prerender route "${route}" must not contain "?", "#", whitespace or "\\"`;
  }
  if (route.includes("//")) return `prerender route "${route}" must not contain "//"`;
  if (/[:{}*]/.test(route)) {
    return `prerender route "${route}" must be param-free (no ":", "{", "}" or "*" segments)`;
  }
  if (route.length > 1 && route.endsWith("/")) {
    return `prerender route "${route}" must not end with "/" (only the root "/" may)`;
  }
  return null;
}

/** Cross-checks for the prerender section, run by `crossCheckConfig` (SPEC §7.1). */
export function crossCheckPrerender(prerender: FacilisPrerenderConfig, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const [index, route] of prerender.routes.entries()) {
    const issue = routeShapeIssue(route);
    if (issue !== null) addIssue(ctx, ["prerender", "routes", index], issue);
    if (seen.has(route)) {
      addIssue(ctx, ["prerender", "routes", index], `duplicate prerender route "${route}"`);
    }
    seen.add(route);
  }

  const origin = prerender.origin;
  if (origin === undefined) return;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    addIssue(ctx, ["prerender", "origin"], `prerender.origin "${origin}" must be an absolute URL`);
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    addIssue(ctx, ["prerender", "origin"], "prerender.origin protocol must be http or https");
  }
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    addIssue(
      ctx,
      ["prerender", "origin"],
      `prerender.origin "${origin}" must be an origin only (no path, query or fragment)`,
    );
  }
  if (url.username !== "" || url.password !== "") {
    addIssue(ctx, ["prerender", "origin"], "prerender.origin must not carry credentials");
  }
}
