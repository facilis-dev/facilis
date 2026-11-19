import {
  callArguments,
  identifierName,
  memberName,
  nodeArray,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import { staticString, type StaticContext } from "../static-eval.ts";

import type { Diagnostic, PolicyCommand, PolicyFact, SourceRef, UnknownFact } from "../types.ts";
import { optionsOf } from "./schema-column-types.ts";
import {
  callbackExpression,
  nodeRef,
  schemaDiagnostics,
  schemaUnknown,
  type DslResolver,
  type DslSymbol,
} from "./schema-dsl.ts";
import {
  ownerPredicate,
  policyColumn,
  readPgPolicyFact,
  rolePredicate,
  tenantPredicate,
} from "./schema-policy-sql.ts";

export interface PolicyInput {
  readonly extras: AstNode | undefined;
  readonly file: ProjectFile;
  readonly graph: ModuleGraph;
  readonly resolver: DslResolver;
}

export interface PolicyScan {
  readonly policies: readonly PolicyFact[];
  readonly diagnostics: readonly Diagnostic[];
}

function scan(policies: readonly PolicyFact[]): PolicyScan {
  return {
    policies,
    diagnostics: schemaDiagnostics(policies.flatMap((policy) => policy.unknown)),
  };
}

function fixedPolicy(
  name: string,
  command: PolicyCommand,
  restrictive: boolean,
  source: SourceRef,
  unknown: readonly UnknownFact[] = [],
  using: string | null = null,
  withCheck: string | null = null,
): PolicyFact {
  return { name, command, restrictive, using, withCheck, source, unknown };
}

function unknownPolicyScan(name: string, reason: string, source: SourceRef): PolicyScan {
  const unknown = schemaUnknown(reason, source);
  return {
    policies: [
      { name, command: "ALL", restrictive: false, using: null, withCheck: null, source, unknown: [unknown] },
    ],
    diagnostics: schemaDiagnostics([unknown]),
  };
}

function calleeLabel(callee: unknown): string {
  const node = unwrapExpression(callee);
  if (node === undefined) return "policy";
  return identifierName(node) ?? memberName(node) ?? "policy";
}



/** `rlsForTable({...})` expands to the same policy set `@facilis.dev/db` builds at runtime. */
function expandRlsTable(call: AstNode, context: StaticContext, file: ProjectFile): PolicyScan {
  const source = nodeRef(file, call);
  const args = callArguments(call);
  let options: Record<string, unknown> = {};
  if (args[0] !== undefined) {
    const evaluated = optionsOf(args[0], context);
    if (evaluated === null) {
      const unknown = schemaUnknown("rlsForTable options are not static", source);
      return {
        policies: [fixedPolicy("tenant_isolation", "ALL", true, source, [unknown])],
        diagnostics: schemaDiagnostics([unknown]),
      };
    }
    options = evaluated;
  }
  const tenantColumn = options["tenantColumn"];
  const tenantUnknown =
    tenantColumn === undefined || typeof tenantColumn === "string"
      ? []
      : [schemaUnknown("rlsForTable tenantColumn is not a string", source)];
  const tenant = typeof tenantColumn === "string" ? tenantColumn : "tenant_id";
  const predicates = tenantPredicate(tenant);
  const policies: PolicyFact[] = [
    fixedPolicy("tenant_isolation", "ALL", true, source, tenantUnknown, predicates, predicates),
  ];
  const ownerColumn = options["ownerColumn"];
  if (Object.hasOwn(options, "ownerColumn")) {
    const unknown =
      typeof ownerColumn === "string"
        ? []
        : [schemaUnknown("rlsForTable ownerColumn is not a string", source)];
    const predicate = typeof ownerColumn === "string" ? ownerPredicate(ownerColumn) : null;
    policies.push(fixedPolicy("owner_isolation", "ALL", false, source, unknown, predicate, predicate));
  }
  const rolesColumn = options["rolesColumn"];
  if (Object.hasOwn(options, "rolesColumn")) {
    const unknown =
      typeof rolesColumn === "string"
        ? []
        : [schemaUnknown("rlsForTable rolesColumn is not a string", source)];
    const predicate = typeof rolesColumn === "string" ? rolePredicate(rolesColumn) : null;
    policies.push(fixedPolicy("role_access", "ALL", false, source, unknown, predicate, predicate));
  }
  return scan(policies);
}

function readRlsExpansion(
  node: AstNode | undefined,
  context: StaticContext,
  file: ProjectFile,
  resolver: DslResolver,
): PolicyScan | null {
  if (node === undefined) return null;
  let call: AstNode | undefined;
  if (node.type === "CallExpression") {
    call = node;
  } else if (node.type === "MemberExpression" && memberName(node) === "policies") {
    const object = unwrapExpression(node.object);
    if (object?.type === "CallExpression") call = object;
  }
  if (call === undefined) return null;
  const symbol: DslSymbol | null = resolver(call.callee);
  if (
    symbol?.pkg !== "facilis-db" ||
    (symbol.name !== "rlsForTable" && symbol.name !== "withRls")
  ) {
    return null;
  }
  return expandRlsTable(call, context, file);
}

/** Index/check/unique entries share the extras callback; schema-extras.ts reads them. */
const NON_POLICY_HELPERS = new Set(["index", "uniqueIndex", "check", "unique", "primaryKey"]);

function isNonPolicyEntry(node: AstNode, resolver: DslResolver): boolean {
  let current: AstNode | undefined = node;
  let guard = 0;
  while (current?.type === "CallExpression" && guard < 32) {
    guard += 1;
    const callee = unwrapExpression(current.callee);
    if (callee === undefined) return false;
    if (callee.type === "MemberExpression") {
      current = unwrapExpression(callee.object);
      continue;
    }
    const symbol = resolver(callee);
    return symbol?.pkg === "pg-core" && NON_POLICY_HELPERS.has(symbol.name);
  }
  return false;
}

function readPolicyEntry(
  element: AstNode,
  context: StaticContext,
  file: ProjectFile,
  resolver: DslResolver,
): PolicyScan {
  const node = unwrapExpression(element);
  const source = nodeRef(file, node ?? element);
  const expansion = readRlsExpansion(node, context, file, resolver);
  if (expansion !== null) return expansion;
  if (node?.type !== "CallExpression") {
    return unknownPolicyScan("policy", "table extras entry is not a policy call", source);
  }
  if (isNonPolicyEntry(node, resolver)) return scan([]);
  const symbol = resolver(node.callee);
  const args = callArguments(node);
  if (symbol?.pkg === "facilis-db") {
    if (symbol.name === "tenantIsolationPolicy" || symbol.name === "ownerIsolationPolicy") {
      const tenant = symbol.name === "tenantIsolationPolicy";
      const evaluated = policyColumn(
        args[0],
        tenant ? "tenant_id" : "owner_id",
        context,
        symbol.name,
        source,
      );
      const predicate =
        evaluated.column === null
          ? null
          : tenant
            ? tenantPredicate(evaluated.column)
            : ownerPredicate(evaluated.column);
      const unknown = evaluated.unknown === null ? [] : [evaluated.unknown];
      return scan([
        fixedPolicy(
          tenant ? "tenant_isolation" : "owner_isolation",
          "ALL",
          tenant,
          source,
          unknown,
          predicate,
          predicate,
        ),
      ]);
    }
    if (symbol.name === "rolePolicy") {
      const unknowns: UnknownFact[] = [];
      const column = policyColumn(args[0], null, context, "rolePolicy", source);
      if (column.unknown !== null) unknowns.push(column.unknown);
      let name = "role_access";
      if (args[1] !== undefined) {
        const evaluated = staticString(args[1], context);
        if (evaluated.ok) {
          name = evaluated.value;
        } else {
          unknowns.push(schemaUnknown("rolePolicy name is not a static string", source));
        }
      }
      const predicate = column.column === null ? null : rolePredicate(column.column);
      return scan([fixedPolicy(name, "ALL", false, source, unknowns, predicate, predicate)]);
    }
  }
  if (symbol?.pkg === "pg-core" && symbol.name === "pgPolicy") {
    return scan([readPgPolicyFact(node, context, file, resolver)]);
  }
  return unknownPolicyScan(
    calleeLabel(node.callee),
    'policy helper "' + calleeLabel(node.callee) + '" is outside the documented DSL',
    source,
  );
}

function readPolicies(
  expression: AstNode,
  context: StaticContext,
  file: ProjectFile,
  resolver: DslResolver,
): PolicyScan {
  const node = unwrapExpression(expression);
  if (node === undefined) {
    return unknownPolicyScan(
      "policy",
      "table extras are not a policy expression",
      nodeRef(file, expression),
    );
  }
  if (node.type === "ArrayExpression") {
    const policies: PolicyFact[] = [];
    const diagnostics: Diagnostic[] = [];
    for (const element of nodeArray(node, "elements")) {
      const spreadArgument =
        element.type === "SpreadElement" ? unwrapExpression(element.argument) : undefined;
      const nested =
        element.type === "SpreadElement"
          ? spreadArgument === undefined
            ? unknownPolicyScan(
                "policy",
                "spread policy entry is not an expression",
                nodeRef(file, element),
              )
            : readPolicies(spreadArgument, context, file, resolver)
          : readPolicyEntry(element, context, file, resolver);
      policies.push(...nested.policies);
      diagnostics.push(...nested.diagnostics);
    }
    return { policies, diagnostics };
  }
  const expansion = readRlsExpansion(node, context, file, resolver);
  if (expansion !== null) return expansion;
  return readPolicyEntry(node, context, file, resolver);
}

export function buildPolicyFacts(input: PolicyInput): PolicyScan {
  if (input.extras === undefined) return { policies: [], diagnostics: [] };
  const expression = callbackExpression(input.extras);
  if (expression === undefined) {
    return unknownPolicyScan(
      "policy",
      "table extras are not a readable callback",
      nodeRef(input.file, input.extras),
    );
  }
  const context: StaticContext = { graph: input.graph, file: input.file.path };
  return readPolicies(expression, context, input.file, input.resolver);
}
