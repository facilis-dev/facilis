import {
  callArguments,
  identifierName,
  objectEntries,
  propertyName,
  propertyValue,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import { isRecord } from "../json.ts";
import type { ProjectFile } from "../module-graph.ts";
import { evaluateStatic, staticString, type StaticContext } from "../static-eval.ts";
import type { PolicyCommand, PolicyFact, SourceRef, UnknownFact } from "../types.ts";
import { nodeRef, schemaUnknown, type DslResolver } from "./schema-dsl.ts";
import { renderSqlTemplate } from "./schema-sql.ts";

const COMMANDS: Readonly<Record<string, PolicyCommand>> = {
  select: "SELECT",
  insert: "INSERT",
  update: "UPDATE",
  delete: "DELETE",
  all: "ALL",
};

// These predicates mirror packages/db/src/rls.ts. The analyzer cannot interpret the helper
// bodies (they are framework code, not project source), but rendering the fixed template here
// keeps a standard policy replayable instead of dropping its USING clause. Any change to
// rls.ts must land here too. There is a test pinning the exact strings.
function quoted(name: string): string {
  return '"' + name.replaceAll('"', '""') + '"';
}

export function tenantPredicate(column: string): string {
  return quoted(column) + " = nullif(current_setting('app.tenant_id', true), '')::uuid";
}

export function ownerPredicate(column: string): string {
  return quoted(column) + " = nullif(current_setting('app.user_id', true), '')::uuid";
}

export function rolePredicate(column: string): string {
  return "nullif(current_setting('app.roles', true), '')::jsonb ? " + quoted(column);
}

/** A policy helper column argument: its literal SQL name, or null + unknown when not static. */
export function policyColumn(
  node: AstNode | undefined,
  fallback: string | null,
  context: StaticContext,
  label: string,
  source: SourceRef,
): { readonly column: string | null; readonly unknown: UnknownFact | null } {
  if (node === undefined) return { column: fallback, unknown: null };
  const evaluated = staticString(node, context);
  return evaluated.ok
    ? { column: evaluated.value, unknown: null }
    : { column: null, unknown: schemaUnknown(label + " column is not a static string", source) };
}

interface PolicyOptions {
  readonly values: Readonly<Record<string, unknown>>;
  readonly usingNode: AstNode | undefined;
  readonly withCheckNode: AstNode | undefined;
  readonly unknown: string | null;
}

/** Options object of pgPolicy, read per property so a SQL value does not hide `for`/`as`. */
function readPolicyOptions(node: AstNode, context: StaticContext): PolicyOptions | null {
  const value = unwrapExpression(node);
  if (value?.type === "ObjectExpression") {
    const values: Record<string, unknown> = {};
    let usingNode: AstNode | undefined;
    let withCheckNode: AstNode | undefined;
    let unknown: string | null = null;
    for (const entry of objectEntries(value)) {
      if (entry.type === "SpreadElement") {
        unknown = "pgPolicy options spread is not static";
        continue;
      }
      const key = propertyName(entry);
      if (key === undefined) {
        unknown = "pgPolicy computed option key is not static";
        continue;
      }
      const property = propertyValue(entry);
      if (key === "using") {
        usingNode = property;
        continue;
      }
      if (key === "withCheck") {
        withCheckNode = property;
        continue;
      }
      const evaluated = evaluateStatic(property, context);
      if (!evaluated.ok) {
        unknown = 'pgPolicy option "' + key + '" is not static';
        continue;
      }
      values[key] = evaluated.value;
    }
    return { values, usingNode, withCheckNode, unknown };
  }
  const evaluated = evaluateStatic(node, context);
  if (!evaluated.ok || !isRecord(evaluated.value)) return null;
  return { values: evaluated.value, usingNode: undefined, withCheckNode: undefined, unknown: null };
}

function readPredicate(
  node: AstNode | undefined,
  context: StaticContext,
  resolver: DslResolver,
  source: SourceRef,
  label: string,
): { readonly sql: string | null; readonly unknown: UnknownFact | null } {
  if (node === undefined) return { sql: null, unknown: null };
  const rendered = renderSqlTemplate(node, {
    context,
    resolver,
    tableParam: null,
    tableName: "",
    columns: new Map(),
    allowExpressions: false,
  });
  if (rendered.sql !== null) return { sql: rendered.sql, unknown: null };
  return {
    sql: null,
    unknown: schemaUnknown(
      label + " is not a static sql template: " + (rendered.reason ?? "unreadable"),
      source,
    ),
  };
}

/** Read a complete pgPolicy(name, options) declaration into a fact (never guessed). */
export function readPgPolicyFact(
  call: AstNode,
  context: StaticContext,
  file: ProjectFile,
  resolver: DslResolver,
): PolicyFact {
  const source = nodeRef(file, call);
  const args = callArguments(call);
  const unknowns: UnknownFact[] = [];
  let name = "unknown";
  const nameResult = staticString(args[0], context);
  if (nameResult.ok) {
    name = nameResult.value;
  } else {
    unknowns.push(schemaUnknown("pgPolicy name is not a static string", source));
  }
  let command: PolicyCommand = "ALL";
  let restrictive = false;
  let using: string | null = null;
  let withCheck: string | null = null;
  if (args[1] !== undefined) {
    const options = readPolicyOptions(args[1], context);
    if (options === null) {
      unknowns.push(schemaUnknown("pgPolicy options are not static", source));
    } else {
      if (options.unknown !== null) unknowns.push(schemaUnknown(options.unknown, source));
      const rawFor = options.values["for"];
      if (rawFor !== undefined) {
        const parsed = typeof rawFor === "string" ? (COMMANDS[rawFor.toLowerCase()] ?? null) : null;
        if (parsed === null) {
          unknowns.push(schemaUnknown('pgPolicy "for" is not a policy command', source));
        } else {
          command = parsed;
        }
      }
      const rawAs = options.values["as"];
      if (rawAs === "restrictive") {
        restrictive = true;
      } else if (rawAs !== undefined && rawAs !== "permissive") {
        unknowns.push(schemaUnknown('pgPolicy "as" is not restrictive or permissive', source));
      }
      const usingResult = readPredicate(options.usingNode, context, resolver, source, "pgPolicy using");
      if (usingResult.unknown !== null) unknowns.push(usingResult.unknown);
      using = usingResult.sql;
      const checkResult = readPredicate(
        options.withCheckNode,
        context,
        resolver,
        source,
        "pgPolicy withCheck",
      );
      if (checkResult.unknown !== null) unknowns.push(checkResult.unknown);
      withCheck = checkResult.sql;
    }
  }
  return { name, command, restrictive, using, withCheck, source, unknown: unknowns };
}

/** Unused helper kept type-safe for the linter: the identifier mangling is shared above. */
export function policyCalleeLabel(callee: unknown): string {
  const node = unwrapExpression(callee);
  if (node === undefined) return "policy";
  return identifierName(node) ?? "policy";
}
