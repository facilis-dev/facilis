/**
 * The `prerender` section of `facilis.config.ts` -> ConfigPrerenderFacts (D-202).
 *
 * Split from config.ts so the config pass stays under the 300-line limit. Defaults mirror
 * packages/core/src/prerender-config.ts exactly ({ routes: [] } = off); a value outside the
 * static subset is an explicit unknown, never a silent guess (D-092).
 */

import type { SourceRef, UnknownFact } from "../types.ts";
import type { ConfigPrerenderFacts } from "../types-prerender.ts";

function routesField(
  section: Record<string, unknown>,
  at: SourceRef,
  unknown: UnknownFact[],
): readonly string[] {
  if (!Object.hasOwn(section, "routes")) return [];
  const value = section.routes;
  if (Array.isArray(value) && value.every((item): item is string => typeof item === "string")) {
    return [...value];
  }
  unknown.push({
    code: "config-static",
    reason: "prerender.routes must be a string[]",
    source: at,
  });
  return [];
}

function originField(
  section: Record<string, unknown>,
  at: SourceRef,
  unknown: UnknownFact[],
): string | null {
  if (!Object.hasOwn(section, "origin")) return null;
  if (typeof section.origin === "string") return section.origin;
  unknown.push({ code: "config-static", reason: "prerender.origin must be a string", source: at });
  return null;
}

/**
 * Read the already-extracted prerender section (null = absent or unreadable; the config pass
 * records the unreadable case). Section unknowns are also pushed into the config-level list
 * so they surface as config-static diagnostics.
 */
export function readPrerenderFields(
  section: Record<string, unknown> | null,
  at: SourceRef,
  unknown: UnknownFact[],
): ConfigPrerenderFacts {
  if (section === null) return { routes: [], origin: null, unknown: [] };
  const local: UnknownFact[] = [];
  const routes = routesField(section, at, local);
  const origin = originField(section, at, local);
  unknown.push(...local);
  return { routes, origin, unknown: local };
}
