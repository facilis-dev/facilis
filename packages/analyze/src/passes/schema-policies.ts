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

const COMMANDS: Readonly<Record<string, PolicyCommand>> = {
  select: "SELECT",
  insert: "INSERT",
  update: "UPDATE",
  delete: "DELETE",
  all: "ALL",
};

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
): PolicyFact {
  return { name, command, restrictive, source, unknown };
}

function unknownPolicyScan(name: string, reason: string, source: SourceRef): PolicyScan {
  const unknown = schemaUnknown(reason, source);
  return {
    policies: [{ name, command: "ALL", restrictive: false, source, unknown: [unknown] }],
    diagnostics: schemaDiagnostics([unknown]),
  };
}

function calleeLabel(callee: unknown): string {
  const node = unwrapExpression(callee);
  if (node === undefined) return "policy";
  return identifierName(node) ?? memberName(node) ?? "policy";
}

function readPgPolicy(call: AstNode, context: StaticContext, file: ProjectFile): PolicyScan {
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
  if (args[1] !== undefined) {
    const options = optionsOf(args[1], context);
    if (options === null) {
      unknowns.push(schemaUnknown("pgPolicy options are not static", source));
    } else {
      const rawFor = options["for"];
      if (rawFor !== undefined) {
        const parsed = typeof rawFor === "string" ? (COMMANDS[rawFor.toLowerCase()] ?? null) : null;
        if (parsed === null) {
          unknowns.push(schemaUnknown('pgPolicy "for" is not a policy command', source));
        } else {
          command = parsed;
        }
      }
      const rawAs = options["as"];
      if (rawAs === "restrictive") {
        restrictive = true;
      } else if (rawAs !== undefined && rawAs !== "permissive") {
        unknowns.push(schemaUnknown('pgPolicy "as" is not restrictive or permissive', source));
      }
    }
  }
  return scan([fixedPolicy(name, command, restrictive, source, unknowns)]);
}

/** `rlsForTable({...})` expands to the same policy set `@facilis/db` builds at runtime. */
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
  const policies: PolicyFact[] = [fixedPolicy("tenant_isolation", "ALL", true, source)];
  const ownerColumn = options["ownerColumn"];
  if (Object.hasOwn(options, "ownerColumn")) {
    const unknown =
      typeof ownerColumn === "string"
        ? []
        : [schemaUnknown("rlsForTable ownerColumn is not a string", source)];
    policies.push(fixedPolicy("owner_isolation", "ALL", false, source, unknown));
  }
  const rolesColumn = options["rolesColumn"];
  if (Object.hasOwn(options, "rolesColumn")) {
    const unknown =
      typeof rolesColumn === "string"
        ? []
        : [schemaUnknown("rlsForTable rolesColumn is not a string", source)];
    policies.push(fixedPolicy("role_access", "ALL", false, source, unknown));
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
  const symbol = resolver(node.callee);
  if (symbol?.pkg === "facilis-db") {
    if (symbol.name === "tenantIsolationPolicy") {
      return scan([fixedPolicy("tenant_isolation", "ALL", true, source)]);
    }
    if (symbol.name === "ownerIsolationPolicy") {
      return scan([fixedPolicy("owner_isolation", "ALL", false, source)]);
    }
    if (symbol.name === "rolePolicy") {
      const args = callArguments(node);
      const unknowns: UnknownFact[] = [];
      let name = "role_access";
      if (args[1] !== undefined) {
        const evaluated = staticString(args[1], context);
        if (evaluated.ok) {
          name = evaluated.value;
        } else {
          unknowns.push(schemaUnknown("rolePolicy name is not a static string", source));
        }
      }
      return scan([fixedPolicy(name, "ALL", false, source, unknowns)]);
    }
  }
  if (symbol?.pkg === "pg-core" && symbol.name === "pgPolicy") {
    return readPgPolicy(node, context, file);
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
