/**
 * The static-template prerender declaration surface (D-202 §2, D-168 amended):
 * `prerender({ routes, origin? })` in `vite.config.ts`, a build-time-only framework plugin.
 *
 * Static projects have no `facilis.config.ts`, `server/` or `db/`; this entry is their
 * allowlist declaration plus the same fail-closed build gate full-stack projects get.
 *
 * MODULE GRAPH CONSTRAINT (D-202/D-168): this entry and everything it imports must stay free
 * of nitro, @facilis.dev/db, @facilis.dev/auth and @facilis.dev/core runtime code — only
 * @facilis.dev/analyze, zod and build tools. The render engine (#83) plugs in below under the
 * same constraint: the SSR runtime is reached only through the generated SSR entry, never
 * imported by this entry's module graph.
 */

import type { Plugin } from "vite";
import { z } from "zod";

import { analyzeProject, prerenderBuildErrors, type Analysis } from "@facilis.dev/analyze";
import { loadProjectFiles } from "@facilis.dev/analyze/fs";

import { facilisPrerenderServing } from "./prerender-dev.ts";
import { facilisPrerenderEngine } from "./prerender-engine.ts";
import { formatPrerenderBuildError } from "./prerender-gate.ts";
import { createRolldownParser } from "./rolldown-parser.ts";

export interface PrerenderOptions {
  /** Absolute, param-free page paths from the one route table (D-058). */
  readonly routes?: readonly string[];
  /** Absolute http(s) origin; enables canonical links + sitemap.xml (D-202 §6). */
  readonly origin?: string;
}

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

// Mirrors packages/core/src/prerender-config.ts (the analyzer defaults-restatement
// precedent): this entry must not import core runtime code, so the schema and cross-checks
// are restated here and a mirror test asserts parity on a shared case table.
const prerenderOptionsSchema = z
  .strictObject({
    routes: z.array(z.string().min(1)).default([]),
    origin: z.string().optional(),
  })
  .superRefine((options, ctx) => {
    const seen = new Set<string>();
    for (const [index, route] of options.routes.entries()) {
      const issue = routeShapeIssue(route);
      if (issue !== null) ctx.addIssue({ code: "custom", message: issue, path: ["routes", index] });
      if (seen.has(route)) {
        ctx.addIssue({
          code: "custom",
          message: `duplicate prerender route "${route}"`,
          path: ["routes", index],
        });
      }
      seen.add(route);
    }
    const origin = options.origin;
    if (origin === undefined) return;
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: `prerender.origin "${origin}" must be an absolute URL`,
        path: ["origin"],
      });
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      ctx.addIssue({
        code: "custom",
        message: "prerender.origin protocol must be http or https",
        path: ["origin"],
      });
    }
    if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
      ctx.addIssue({
        code: "custom",
        message: `prerender.origin "${origin}" must be an origin only (no path, query or fragment)`,
        path: ["origin"],
      });
    }
    if (url.username !== "" || url.password !== "") {
      ctx.addIssue({
        code: "custom",
        message: "prerender.origin must not carry credentials",
        path: ["origin"],
      });
    }
  });

export const PRERENDER_PLUGIN_NAME = "facilis:prerender";

/**
 * Declare the static-template prerender allowlist. Validation mirrors the full-stack
 * `prerender` config section; at build start the analyzer's fail-closed eligibility facts
 * gate the build exactly like the full-stack companion plugin, then the same in-process
 * engine (D-202 Arm C) renders the allowlist and the serving hooks preview it.
 */
export function prerender(options: PrerenderOptions = {}): Plugin[] {
  const parsed = prerenderOptionsSchema.safeParse(options);
  if (!parsed.success) {
    throw new Error(`Invalid prerender options:\n${z.prettifyError(parsed.error)}`);
  }
  const declaration = parsed.data;
  let root = process.cwd();
  let analysis: Analysis | undefined;
  const getAnalysis = (): Analysis => {
    analysis ??= analyzeProject({
      files: loadProjectFiles(root),
      parser: createRolldownParser(),
    });
    return analysis;
  };
  const gate: Plugin = {
    name: PRERENDER_PLUGIN_NAME,
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    buildStart() {
      if (declaration.routes.length === 0) return;
      for (const failure of prerenderBuildErrors(getAnalysis().prerender)) {
        this.error(formatPrerenderBuildError(failure));
      }
    },
  };
  return [
    gate,
    facilisPrerenderEngine({ mode: "static", getAnalysis, getDeclaration: () => declaration }).plugin,
    facilisPrerenderServing(() => root),
  ];
}
