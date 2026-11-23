/**
 * Session-dependent guard detection for prerender eligibility (D-202 §3).
 *
 * A guard counts only when the JSX component resolves through the module graph to an
 * IMPORTED binding: a local component named RequireAuth is not the framework's guard (the
 * route-table.ts importedLocals precedent). Ancestors are walked too, because a pathless
 * layout route can wrap every page below it.
 */

import type { AstNode } from "../ast/node.ts";
import { walk } from "../ast/walk.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import { elementName } from "./jsx.ts";
import type { RouteEntry } from "./route-table.ts";

/** The framework's session-dependent guards (docs/FRONTEND.md); both make a page private. */
const GUARD_NAMES: ReadonlySet<string> = new Set(["RequireAuth", "PublicOnly"]);

/** Local names bound to react-router-dom's Navigate (a redirect, not a page). */
export function navigateLocals(file: ProjectFile): ReadonlySet<string> {
  const names = new Set<string>();
  for (const entry of file.module.imports) {
    if (entry.specifier === "react-router-dom" && entry.imported === "Navigate") {
      names.add(entry.local);
    }
  }
  return names;
}

function elementHasGuard(graph: ModuleGraph, appFile: ProjectFile, element: AstNode): boolean {
  let found = false;
  walk(element, (node) => {
    if (found || node.type !== "JSXElement") return;
    const name = elementName(node);
    if (name === null || !GUARD_NAMES.has(name)) return;
    const binding = graph.resolveBinding(appFile.path, name);
    if (binding !== null && binding.file !== appFile.path) found = true;
  });
  return found;
}

/** True when the entry or any ancestor route element carries an imported session guard. */
export function hasAuthGuard(
  graph: ModuleGraph,
  appFile: ProjectFile,
  entries: readonly RouteEntry[],
  entryIndex: number,
): boolean {
  let current: number | null = entryIndex;
  while (current !== null) {
    const entry: RouteEntry | undefined = entries[current];
    if (entry === undefined) break;
    if (entry.element !== null && elementHasGuard(graph, appFile, entry.element)) return true;
    current = entry.parentIndex;
  }
  return false;
}
