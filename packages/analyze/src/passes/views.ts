/**
 * `db/views/**` -> ViewFacts (D-157, SPEC §11.2).
 *
 * A view is declared one per file with `defineView({ name, columns, query, tables?,
 * permission? })` from @facilis/db (D-097/D-098). The route-relations pass resolves a view
 * object used in `from(...)` to this fact, so a route declares the view's SQL name in
 * `dbTables` instead of its base tables. D-160 adds the view nodes and their edges to the
 * project graph; this pass stays facts-only.
 *
 * The declaration is read through the bounded static subset; an unreadable name/tables/
 * permission is an explicit unknown, never a guessed value.
 */

import { callArguments, identifierName, unwrapExpression, type AstNode } from "../ast/node.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import type { Diagnostic, UnknownFact, ViewFact } from "../types.ts";
import {
  createDslResolver,
  isViewFile,
  nodeRef,
  schemaDiagnostics,
  topLevelDeclarators,
  type DslResolver,
} from "./schema-dsl.ts";
import { readStaticObject } from "./static-read.ts";

export interface ViewScan {
  readonly views: readonly ViewFact[];
  readonly diagnostics: readonly Diagnostic[];
}

function viewUnknown(reason: string, source: ViewFact["source"]): UnknownFact {
  return { code: "view-static", reason, source };
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((entry): entry is string => typeof entry === "string") ? [...value] : null;
}

/** The `defineView(...)` call an initializer holds, when it is the @facilis/db DSL. */
function viewCall(init: unknown, resolver: DslResolver): AstNode | null {
  const expression = unwrapExpression(init);
  if (expression?.type !== "CallExpression") return null;
  const symbol = resolver(expression.callee);
  return symbol?.pkg === "facilis-db" && symbol.name === "defineView" ? expression : null;
}

function buildViewDraft(
  graph: ModuleGraph,
  file: ProjectFile,
  declarator: AstNode,
  call: AstNode,
): { view: ViewFact; diagnostics: readonly Diagnostic[] } {
  const source = nodeRef(file, call);
  const binding = identifierName(declarator.id) ?? null;
  const unknowns: UnknownFact[] = [];
  const options = readStaticObject(
    callArguments(call)[0],
    { graph, file: file.path },
    { code: "view-static", report: false },
  );
  unknowns.push(...options.unknown);

  const nameField = options.fields.get("name");
  let name = binding ?? "unknown";
  if (nameField !== undefined && nameField.ok && typeof nameField.value === "string") {
    if (nameField.value.length > 0) name = nameField.value;
    else unknowns.push(viewUnknown("view name is not a static string", source));
  } else if (nameField !== undefined && !nameField.ok) {
    unknowns.push(viewUnknown("view name is missing or not statically readable", source));
  } else {
    unknowns.push(viewUnknown("view name is missing or not a static string", source));
  }

  let tables: string[] = [];
  const tablesField = options.fields.get("tables");
  if (tablesField !== undefined) {
    const read = tablesField.ok ? stringArray(tablesField.value) : null;
    if (read === null) {
      unknowns.push(viewUnknown("view tables are not a static string[]", source));
    } else {
      tables = read;
    }
  }

  const permissionField = options.fields.get("permission");
  let permission: string | null = null;
  let access: ViewFact["access"] = "invoker";
  if (permissionField !== undefined) {
    if (permissionField.ok && typeof permissionField.value === "string") {
      permission = permissionField.value;
      access = "definer";
    } else {
      // We cannot tell an invoker declaration from a definer one: keep the mode unknown.
      access = null;
      unknowns.push(viewUnknown("view permission is not a static string", source));
    }
  }

  return {
    view: { name, binding, tables, permission, access, source, unknown: unknowns },
    diagnostics: schemaDiagnostics(unknowns),
  };
}

/** Read `db/views/**` into view facts. */
export function buildViewFacts(graph: ModuleGraph): ViewScan {
  const files = [...graph.files.values()]
    .filter((file) => isViewFile(graph, file.path))
    .toSorted((left, right) => left.path.localeCompare(right.path));
  const views: ViewFact[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const file of files) {
    const resolver = createDslResolver(graph, file);
    for (const declarator of topLevelDeclarators(file.program)) {
      const call = viewCall(declarator.init, resolver);
      if (call === null) continue;
      const draft = buildViewDraft(graph, file, declarator, call);
      views.push(draft.view);
      diagnostics.push(...draft.diagnostics);
    }
  }
  return { views, diagnostics };
}
