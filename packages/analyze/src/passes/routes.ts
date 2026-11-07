/**
 * Route files -> RouteFacts (docs/findings/ast-dsl-contract.md §3.1).
 *
 * A route is listed even when it does not use the wrapper: the graph is also the integrity
 * view, so an invalid route is reported instead of omitted. The filename is the only source
 * of method/path (Nitro's file router); the default export is the only source of the config.
 */

import { callArguments, identifierName, unwrapExpression, type AstNode } from "../ast/node.ts";
import { error, info } from "../diagnostics.ts";
import { defaultExportDeclaration } from "../module-info.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import { sourceRef } from "../source.ts";
import type { StaticContext } from "../static-eval.ts";
import type {
  ConfigFacts,
  Diagnostic,
  RouteFact,
  RouteInputFact,
  SourceRef,
  UnknownFact,
  WrapperState,
} from "../types.ts";
import { directDbWarnings, handlerReadsBody } from "./route-handler.ts";
import { routeLocationFromFile } from "./route-location.ts";
import {
  defaultExportExpression,
  isLocallyDeclared,
  readStaticObject,
  relativePath,
  refOf,
  sortDiagnostics,
  type StaticField,
} from "./static-read.ts";

const CORE_SPECIFIER = "@facilis/core";
const ROUTE_DIRS = ["server/routes/", "server/api/"];
const MISSING_PERMISSION = "permission is missing";
const MISSING_TABLES = "dbTables is missing; declare an array ([] means no DB)";

export interface RouteResult {
  readonly routes: readonly RouteFact[];
  readonly diagnostics: readonly Diagnostic[];
}

interface WrapperResolution {
  readonly state: WrapperState;
  readonly call: AstNode | null;
  readonly reason: string;
}

/** The default export must be a `defineAuthorizedHandler(...)` call of the core import. */
function resolveWrapper(file: ProjectFile): WrapperResolution {
  const expression = defaultExportExpression(file);
  if (expression === undefined) {
    return { state: "invalid", call: null, reason: "the route file has no default export" };
  }
  if (expression.type !== "CallExpression") {
    return {
      state: "invalid",
      call: null,
      reason: "the default export is not a defineAuthorizedHandler() call",
    };
  }
  const callee = unwrapExpression(expression.callee);
  const name = callee?.type === "Identifier" ? identifierName(callee) : undefined;
  if (name === undefined) {
    return { state: "unknown", call: null, reason: "the handler callee cannot be resolved" };
  }
  if (isLocallyDeclared(file, name)) {
    return {
      state: "invalid",
      call: null,
      reason: '"' + name + '" is shadowed by a local declaration',
    };
  }
  const imported = file.module.imports.find((entry) => entry.local === name);
  if (
    imported === undefined ||
    imported.specifier !== CORE_SPECIFIER ||
    imported.imported !== "defineAuthorizedHandler"
  ) {
    return {
      state: "invalid",
      call: null,
      reason: "the default export is not the defineAuthorizedHandler import from @facilis/core",
    };
  }
  return { state: "valid", call: expression, reason: "" };
}

function stringArrayValue(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item): item is string => typeof item === "string") ? [...value] : null;
}

function permissionValue(value: unknown): string[] | null {
  return typeof value === "string" ? [value] : stringArrayValue(value);
}

interface RouteConfigFacts {
  readonly permission: readonly string[] | null;
  readonly dbTables: readonly string[] | null;
  readonly dbColumns: readonly string[] | null;
  readonly description: string | null;
  readonly input: RouteInputFact;
  readonly unknown: readonly UnknownFact[];
  readonly diagnostics: readonly Diagnostic[];
}

function addUnknown(list: UnknownFact[], code: string, reason: string, source: SourceRef): void {
  list.push({ code, reason, source });
}

function unreadable(field: string, entry: StaticField): string {
  return field + " cannot be read statically: " + (entry.reason ?? "unsupported expression");
}

/** Read the wrapper config from the static subset; every failure is explicit. */
function routeConfigFacts(
  graph: ModuleGraph,
  file: ProjectFile,
  call: AstNode,
  config: ConfigFacts,
): RouteConfigFacts {
  const context: StaticContext = { graph, file: file.path };
  const ref = refOf(context, call);
  // Input schemas (body/query/params) are read for presence only: a Zod expression there is
  // expected, so only the security/display fields below report a static-read failure.
  const object = readStaticObject(callArguments(call)[0], context, {
    code: "route-config-static",
    report: false,
  });
  const unknown: UnknownFact[] = [...object.unknown];
  const field = (name: string): StaticField | undefined => object.fields.get(name);

  const permissionField = field("permission");
  let permission: string[] | null = null;
  if (permissionField === undefined) {
    addUnknown(unknown, "route-config-static", MISSING_PERMISSION, ref);
  } else if (!permissionField.ok) {
    addUnknown(unknown, "route-config-static", unreadable("permission", permissionField), ref);
  } else {
    permission = permissionValue(permissionField.value);
    if (permission === null) {
      addUnknown(unknown, "route-config-static", "permission must be a string or string[]", ref);
    }
  }

  const tablesField = field("dbTables");
  let dbTables: string[] | null = null;
  if (tablesField === undefined) {
    addUnknown(unknown, "db-tables-present", MISSING_TABLES, ref);
  } else if (!tablesField.ok) {
    addUnknown(unknown, "route-config-static", unreadable("dbTables", tablesField), ref);
  } else {
    dbTables = stringArrayValue(tablesField.value);
    if (dbTables === null) {
      addUnknown(unknown, "route-config-static", "dbTables must be a string[]", ref);
    }
  }

  const columnsField = field("dbColumns");
  let dbColumns: string[] | null = columnsField === undefined ? [] : null;
  if (columnsField !== undefined && !columnsField.ok) {
    dbColumns = null;
    addUnknown(unknown, "route-config-static", unreadable("dbColumns", columnsField), ref);
  } else if (columnsField !== undefined) {
    dbColumns = stringArrayValue(columnsField.value);
    if (dbColumns === null) {
      addUnknown(unknown, "route-config-static", "dbColumns must be a string[]", ref);
    }
  }

  const descriptionField = field("description");
  let description: string | null = null;
  if (descriptionField !== undefined && !descriptionField.ok) {
    addUnknown(unknown, "route-config-static", unreadable("description", descriptionField), ref);
  } else if (descriptionField !== undefined) {
    if (typeof descriptionField.value === "string") description = descriptionField.value;
    else addUnknown(unknown, "route-config-static", "description must be a string", ref);
  }

  const input: RouteInputFact = {
    body: field("body") !== undefined,
    query: field("query") !== undefined,
    params: field("params") !== undefined,
  };

  const diagnostics: Diagnostic[] = unknown.map((item) =>
    error(item.code, item.reason, item.source),
  );
  if (permission !== null) {
    for (const name of permission) {
      if (!config.permissions.includes(name)) {
        diagnostics.push(
          error(
            "permission-declared",
            'permission "' + name + '" is not declared in config.auth.permissions',
            ref,
          ),
        );
      }
    }
  }
  return { permission, dbTables, dbColumns, description, input, unknown, diagnostics };
}

function scanRoute(
  graph: ModuleGraph,
  file: ProjectFile,
  config: ConfigFacts,
): { route: RouteFact | null; diagnostics: readonly Diagnostic[] } {
  const relative = relativePath(graph.root, file.path);
  const dir = ROUTE_DIRS.find((candidate) => relative.startsWith(candidate));
  const declaration = defaultExportDeclaration(file.program);
  const anchor = declaration?.start ?? 0;
  if (dir === undefined) return { route: null, diagnostics: [] };
  const location = routeLocationFromFile(relative.slice(dir.length));
  if (location === undefined) {
    return {
      route: null,
      diagnostics: [
        info(
          "unknown",
          "cannot derive a route method/path from the route file name",
          sourceRef(file.path, file.source, anchor),
        ),
      ],
    };
  }
  const wrapper = resolveWrapper(file);
  const ref = sourceRef(file.path, file.source, wrapper.call?.start ?? anchor);
  if (wrapper.state !== "valid" || wrapper.call === null) {
    return {
      route: {
        method: location.method,
        path: location.path,
        sourceFile: file.path,
        source: ref,
        wrapper: wrapper.state,
        permission: null,
        dbTables: null,
        dbColumns: null,
        description: null,
        input: { body: false, query: false, params: false },
        handlerBodyRead: false,
        unknown: [{ code: "route-wrapper", reason: wrapper.reason, source: ref }],
      },
      diagnostics: [error("route-wrapper", wrapper.reason, ref)],
    };
  }
  const facts = routeConfigFacts(graph, file, wrapper.call, config);
  return {
    route: {
      method: location.method,
      path: location.path,
      sourceFile: file.path,
      source: ref,
      wrapper: "valid",
      permission: facts.permission,
      dbTables: facts.dbTables,
      dbColumns: facts.dbColumns,
      description: facts.description,
      input: facts.input,
      handlerBodyRead: handlerReadsBody(wrapper.call),
      unknown: facts.unknown,
    },
    diagnostics: [...facts.diagnostics, ...directDbWarnings(file, ref)],
  };
}

/** Read `server/routes/**` and `server/api/**` into route facts. */
export function buildRouteFacts(graph: ModuleGraph, config: ConfigFacts): RouteResult {
  const files = [...graph.files.values()]
    .filter((file) => ROUTE_DIRS.some((dir) => relativePath(graph.root, file.path).startsWith(dir)))
    .toSorted((left, right) => left.path.localeCompare(right.path));
  const routes: RouteFact[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const file of files) {
    const scanned = scanRoute(graph, file, config);
    if (scanned.route !== null) routes.push(scanned.route);
    diagnostics.push(...scanned.diagnostics);
  }
  routes.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.method.localeCompare(right.method) ||
      left.sourceFile.localeCompare(right.sourceFile),
  );
  return { routes, diagnostics: sortDiagnostics(diagnostics) };
}
