/**
 * The `defineRawRoute` config subset (D-226 decision 2).
 *
 * A raw route is legitimate only with a non-empty reason and an explicit `auth` choice.
 * Missing or unreadable values stay null (unknown), never defaulted: an undeclared raw route
 * must fail the build, not look public or authenticated because a field was absent.
 */
import { callArguments, type AstNode } from "../ast/node.ts";
import { error } from "../diagnostics.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import type { StaticContext } from "../static-eval.ts";
import type { ConfigFacts, Diagnostic, RouteInputFact, SourceRef, UnknownFact } from "../types.ts";
import { readStaticObject, refOf, type StaticField } from "./static-read.ts";

export interface RawRouteConfigFacts {
  readonly permission: readonly string[] | null;
  readonly dbTables: readonly string[] | null;
  readonly dbColumns: readonly string[] | null;
  readonly description: string | null;
  readonly input: RouteInputFact;
  readonly reason: string | null;
  readonly auth: "required" | "none" | null;
  /** True when the route may be mounted: reason and auth are both valid. */
  readonly declared: boolean;
  readonly unknown: readonly UnknownFact[];
  readonly diagnostics: readonly Diagnostic[];
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item): item is string => typeof item === "string") ? [...value] : null;
}

function permissionValue(value: unknown): string[] | null {
  return typeof value === "string" ? [value] : stringArray(value);
}

function addUnknown(list: UnknownFact[], code: string, reason: string, source: SourceRef): void {
  list.push({ code, reason, source });
}

/** Read the raw-route config from the static subset; every failure is explicit. */
export function rawRouteConfigFacts(
  graph: ModuleGraph,
  file: ProjectFile,
  call: AstNode,
  config: ConfigFacts,
): RawRouteConfigFacts {
  const context: StaticContext = { graph, file: file.path };
  const ref = refOf(context, call);
  const object = readStaticObject(callArguments(call)[0], context, {
    code: "route-config-static",
    report: false,
  });
  const unknown: UnknownFact[] = [...object.unknown];
  const diagnostics: Diagnostic[] = [];
  const field = (name: string): StaticField | undefined => object.fields.get(name);

  const reasonField = field("reason");
  let reason: string | null = null;
  if (reasonField === undefined || !reasonField.ok) {
    diagnostics.push(
      error("surface-undeclared", "defineRawRoute requires a non-empty reason", ref),
    );
  } else if (typeof reasonField.value === "string" && reasonField.value.trim().length > 0) {
    reason = reasonField.value.trim();
  } else {
    diagnostics.push(
      error("surface-undeclared", "defineRawRoute reason must be a non-empty string", ref),
    );
  }

  const authField = field("auth");
  let auth: "required" | "none" | null = null;
  if (authField === undefined || !authField.ok) {
    diagnostics.push(
      error("surface-undeclared", 'defineRawRoute requires auth: "required" | "none"', ref),
    );
  } else if (authField.value === "required" || authField.value === "none") {
    auth = authField.value;
  } else {
    diagnostics.push(error("surface-undeclared", 'auth must be "required" or "none"', ref));
  }

  const permissionField = field("permission");
  let permission: string[] | null = [];
  if (permissionField !== undefined) {
    if (!permissionField.ok) {
      permission = null;
      addUnknown(unknown, "route-config-static", "permission cannot be read statically", ref);
    } else {
      permission = permissionValue(permissionField.value);
      if (permission === null) {
        addUnknown(unknown, "route-config-static", "permission must be a string or string[]", ref);
      }
    }
  }
  if (auth === "none" && permission !== null && permission.length > 0) {
    diagnostics.push(
      error("surface-undeclared", 'a raw route with auth: "none" cannot declare a permission', ref),
    );
  }
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

  const tablesField = field("dbTables");
  let dbTables: string[] | null = [];
  if (tablesField !== undefined) {
    if (!tablesField.ok) {
      dbTables = null;
      addUnknown(unknown, "route-config-static", "dbTables cannot be read statically", ref);
    } else {
      dbTables = stringArray(tablesField.value);
      if (dbTables === null) {
        addUnknown(unknown, "route-config-static", "dbTables must be a string[]", ref);
      }
    }
  }

  const descriptionField = field("description");
  let description: string | null = null;
  if (descriptionField !== undefined) {
    if (!descriptionField.ok) {
      addUnknown(unknown, "route-config-static", "description cannot be read statically", ref);
    } else if (typeof descriptionField.value === "string") {
      description = descriptionField.value;
    } else {
      addUnknown(unknown, "route-config-static", "description must be a string", ref);
    }
  }

  const declared = reason !== null && auth !== null && permission !== null && dbTables !== null;
  if (!declared) {
    diagnostics.push(
      error("surface-undeclared", "raw route is undeclared: fix the reason/auth fields", ref),
    );
  }
  diagnostics.push(...unknown.map((item) => error(item.code, item.reason, item.source)));

  return {
    permission,
    dbTables,
    dbColumns: [],
    description,
    input: { body: false, form: false, query: false, params: false },
    reason,
    auth,
    declared,
    unknown,
    diagnostics,
  };
}
