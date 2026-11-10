/**
 * The wrapper config subset: permission/crossSite/dbTables/dbColumns/description/input.
 *
 * Split from routes.ts so both modules stay under the 300-line limit; every failure is an
 * explicit unknown (never an empty value) and a diagnostic, as in the rest of the analyzer.
 */

import { callArguments, type AstNode } from "../ast/node.ts";
import { error, warning } from "../diagnostics.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import type { StaticContext } from "../static-eval.ts";
import type { ConfigFacts, Diagnostic, RouteInputFact, SourceRef, UnknownFact } from "../types.ts";
import { descriptionDiagnostics } from "./route-description.ts";
import { readStaticObject, refOf, type StaticField } from "./static-read.ts";

const MISSING_PERMISSION = "permission is missing";
const MISSING_TABLES = "dbTables is missing; declare an array ([] means no DB)";

export interface RouteConfigFacts {
  readonly permission: readonly string[] | null;
  /** True when the wrapper opts the route into cross-origin calls; null when unreadable. */
  readonly crossSite: boolean | null;
  readonly dbTables: readonly string[] | null;
  readonly dbColumns: readonly string[] | null;
  readonly description: string | null;
  readonly input: RouteInputFact;
  readonly unknown: readonly UnknownFact[];
  readonly diagnostics: readonly Diagnostic[];
}

function stringArrayValue(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item): item is string => typeof item === "string") ? [...value] : null;
}

function permissionValue(value: unknown): string[] | null {
  return typeof value === "string" ? [value] : stringArrayValue(value);
}

function addUnknown(list: UnknownFact[], code: string, reason: string, source: SourceRef): void {
  list.push({ code, reason, source });
}

function unreadable(field: string, entry: StaticField): string {
  return field + " cannot be read statically: " + (entry.reason ?? "unsupported expression");
}

/** Read the wrapper config from the static subset; every failure is explicit. */
export function routeConfigFacts(
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

  const crossSiteField = field("crossSite");
  let crossSite: boolean | null = false;
  if (crossSiteField !== undefined && !crossSiteField.ok) {
    crossSite = null;
    addUnknown(unknown, "route-config-static", unreadable("crossSite", crossSiteField), ref);
  } else if (crossSiteField !== undefined) {
    if (typeof crossSiteField.value === "boolean") crossSite = crossSiteField.value;
    else {
      crossSite = null;
      addUnknown(unknown, "route-config-static", "crossSite must be a boolean", ref);
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
    form: field("form") !== undefined,
    query: field("query") !== undefined,
    params: field("params") !== undefined,
  };

  const diagnostics: Diagnostic[] = [
    ...unknown.map((item) => error(item.code, item.reason, item.source)),
    ...descriptionDiagnostics(description, ref),
  ];
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
  // v3a: crossSite + a non-empty permission is legal now (the route is reached with a Bearer
  // token); the warning only reminds the author that a session cookie never crosses origins.
  if (crossSite === true && permission !== null && permission.length > 0) {
    diagnostics.push(
      warning(
        "route-cross-site-authenticated",
        "crossSite route requires a Bearer token: session cookies never cross origins",
        ref,
      ),
    );
  }
  return { permission, crossSite, dbTables, dbColumns, description, input, unknown, diagnostics };
}
