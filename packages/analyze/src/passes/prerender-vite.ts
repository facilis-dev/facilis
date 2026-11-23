/**
 * The static-template prerender declaration (D-202 §2): a `prerender({ routes, origin? })`
 * call in the root `vite.config.ts`, imported from `@facilis.dev/nitro/prerender`.
 *
 * Static projects have no `facilis.config.ts`; the allowlist lives in the Vite config as a
 * build-time-only framework plugin option. Only a call whose callee resolves to that import
 * counts (the route-table.ts importedLocals precedent) — a local function with the same name
 * is not the framework declaration. Zero execution: unreadable -> unknown, never guessed.
 */

import { callArguments, identifierName, unwrapExpression, type AstNode } from "../ast/node.ts";
import { walk } from "../ast/walk.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import type { SourceRef, UnknownFact } from "../types.ts";
import { projectPath, readStaticObject, refOf, type StaticObject } from "./static-read.ts";

const VITE_CONFIG_FILE = "vite.config.ts";
const PRERENDER_SPECIFIER = "@facilis.dev/nitro/prerender";

export interface PrerenderDeclaration {
  readonly routes: readonly string[];
  readonly origin: string | null;
  readonly unknown: readonly UnknownFact[];
  readonly source: SourceRef | null;
}

export const NO_PRERENDER_DECLARATION: PrerenderDeclaration = {
  routes: [],
  origin: null,
  unknown: [],
  source: null,
};

function prerenderLocals(graph: ModuleGraph): ReadonlySet<string> {
  const file = graph.file(projectPath(graph.root, VITE_CONFIG_FILE));
  const names = new Set<string>();
  if (file === undefined) return names;
  for (const entry of file.module.imports) {
    if (entry.specifier !== PRERENDER_SPECIFIER) continue;
    if ((entry.imported ?? "default") !== "prerender") continue;
    names.add(entry.local);
  }
  return names;
}

function routesField(obj: StaticObject, at: SourceRef, unknown: UnknownFact[]): readonly string[] {
  const field = obj.fields.get("routes");
  if (field === undefined) return [];
  const value = field.value;
  if (
    field.ok &&
    Array.isArray(value) &&
    value.every((item): item is string => typeof item === "string")
  ) {
    return [...value];
  }
  unknown.push({
    code: "prerender-static",
    reason: "prerender routes must be a string[]",
    source: at,
  });
  return [];
}

function originField(obj: StaticObject, at: SourceRef, unknown: UnknownFact[]): string | null {
  const field = obj.fields.get("origin");
  if (field === undefined) return null;
  if (field.ok && typeof field.value === "string") return field.value;
  unknown.push({
    code: "prerender-static",
    reason: "prerender origin must be a string",
    source: at,
  });
  return null;
}

function findPrerenderCall(file: ProjectFile, locals: ReadonlySet<string>): AstNode | null {
  let found: AstNode | null = null;
  walk(file.program, (node) => {
    if (found !== null || node.type !== "CallExpression") return;
    const name = identifierName(unwrapExpression(node.callee));
    if (name !== undefined && locals.has(name)) found = node;
  });
  return found;
}

/** Read the static-template allowlist; off (empty) when absent or not statically readable. */
export function readVitePrerenderDeclaration(graph: ModuleGraph): PrerenderDeclaration {
  const file = graph.file(projectPath(graph.root, VITE_CONFIG_FILE));
  const locals = prerenderLocals(graph);
  if (file === undefined || locals.size === 0) return NO_PRERENDER_DECLARATION;

  const call = findPrerenderCall(file, locals);
  if (call === null) return NO_PRERENDER_DECLARATION;

  const context = { graph, file: file.path };
  const at = refOf(context, call);
  const obj = readStaticObject(callArguments(call)[0], context, {
    code: "prerender-static",
    report: true,
  });
  const unknown: UnknownFact[] = [...obj.unknown];
  const routes = routesField(obj, at, unknown);
  const origin = originField(obj, at, unknown);
  return { routes, origin, unknown, source: at };
}
