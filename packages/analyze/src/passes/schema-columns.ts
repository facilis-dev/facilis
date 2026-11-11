import {
  callArguments,
  identifierName,
  literalString,
  memberName,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import { staticString, type StaticContext } from "../static-eval.ts";
import type {
  ColumnDefaultFact,
  ColumnFact,
  Diagnostic,
  SourceRef,
  UnknownFact,
} from "../types.ts";
import {
  callbackExpression,
  nodeRef,
  schemaDiagnostics,
  schemaUnknown,
  type DslResolver,
  type DslSymbol,
} from "./schema-dsl.ts";
import { displayType, optionsOf, readDefault } from "./schema-column-types.ts";

/** A `.references(() => table.column, opts)` target; the table name is resolved after every draft exists. */
export interface ForeignKeyTarget {
  readonly binding: string;
  readonly property: string;
  readonly onDelete: string | null;
  readonly onUpdate: string | null;
  readonly source: SourceRef;
}

export interface ColumnReference {
  readonly column: string;
  readonly target: ForeignKeyTarget;
}

export interface ColumnResult {
  readonly column: ColumnFact;
  readonly reference: ForeignKeyTarget | null;
  /** True when the builder is `tenantColumn()`; the table pass turns it into a scope fact. */
  readonly tenant: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

export interface ColumnInput {
  readonly property: string;
  readonly expression: unknown;
  /** Property node: the source line when the value is unreadable. */
  readonly propertyNode: AstNode;
  readonly file: ProjectFile;
  readonly graph: ModuleGraph;
  readonly resolver: DslResolver;
  /** Local `pgEnum` const bindings, local name -> enum name. */
  readonly enums: ReadonlyMap<string, string>;
}

interface MethodCall {
  readonly name: string;
  readonly args: readonly AstNode[];
  readonly node: AstNode;
}

interface BuilderChain {
  readonly builder: DslSymbol | null;
  readonly calleeName: string;
  readonly args: readonly AstNode[];
  readonly methods: readonly MethodCall[];
  readonly enumType: string | null;
}

const PG_BUILDERS = new Set([
  "uuid",
  "text",
  "boolean",
  "timestamp",
  "varchar",
  "integer",
  "bigint",
  "numeric",
  "date",
  "jsonb",
  "json",
  "serial",
  "bigserial",
  "real",
  "doublePrecision",
]);

function isKnownBuilder(symbol: DslSymbol): boolean {
  if (symbol.pkg === "pg-core") return PG_BUILDERS.has(symbol.name);
  return symbol.pkg === "facilis-db" && symbol.name === "tenantColumn";
}

/** Split `uuid("id").primaryKey().defaultRandom()` into its builder call and chained methods. */
function readBuilderChain(
  expression: unknown,
  resolver: DslResolver,
  enums: ReadonlyMap<string, string>,
): BuilderChain | null {
  let current = unwrapExpression(expression);
  const methods: MethodCall[] = [];
  let guard = 0;
  while (current !== undefined && guard < 32) {
    guard += 1;
    if (current.type !== "CallExpression") return null;
    const callee = unwrapExpression(current.callee);
    if (callee === undefined) return null;
    const args = callArguments(current);
    if (callee.type === "MemberExpression") {
      const name = memberName(callee);
      if (name === undefined) return null;
      methods.unshift({ name, args, node: current });
      current = unwrapExpression(callee.object);
      continue;
    }
    const calleeName = identifierName(callee);
    if (calleeName === undefined) return null;
    const enumType = enums.get(calleeName);
    if (enumType !== undefined) {
      return { builder: null, calleeName, args, methods, enumType };
    }
    return { builder: resolver(callee), calleeName, args, methods, enumType: null };
  }
  return null;
}

function optionString(
  options: Record<string, unknown>,
  key: string,
  source: SourceRef,
  unknowns: UnknownFact[],
): string | null {
  if (!Object.hasOwn(options, key)) return null;
  const value = options[key];
  if (typeof value === "string") return value;
  unknowns.push(schemaUnknown('references() option "' + key + '" is not a string', source));
  return null;
}

function readReference(
  method: MethodCall,
  context: StaticContext,
  file: ProjectFile,
): { target: ForeignKeyTarget | null; unknowns: UnknownFact[] } {
  const source = nodeRef(file, method.node);
  const target = callbackExpression(method.args[0]);
  const binding =
    target?.type === "MemberExpression"
      ? identifierName(unwrapExpression(target.object))
      : undefined;
  const property = target?.type === "MemberExpression" ? memberName(target) : undefined;
  if (binding === undefined || property === undefined) {
    return {
      target: null,
      unknowns: [
        schemaUnknown("references() target is not a static table.column reference", source),
      ],
    };
  }
  const unknowns: UnknownFact[] = [];
  let onDelete: string | null = null;
  let onUpdate: string | null = null;
  if (method.args[1] !== undefined) {
    const options = optionsOf(method.args[1], context);
    if (options === null) {
      unknowns.push(schemaUnknown("references() options are not static", source));
    } else {
      onDelete = optionString(options, "onDelete", source, unknowns);
      onUpdate = optionString(options, "onUpdate", source, unknowns);
    }
  }
  return { target: { binding, property, onDelete, onUpdate, source }, unknowns };
}

export function buildColumnFact(input: ColumnInput): ColumnResult {
  const context: StaticContext = { graph: input.graph, file: input.file.path };
  const valueNode = unwrapExpression(input.expression);
  const source = nodeRef(input.file, valueNode ?? input.propertyNode);
  const chain = readBuilderChain(input.expression, input.resolver, input.enums);
  const unknowns: UnknownFact[] = [];
  let builder = "unknown";
  let type = "unknown";
  let name = input.property;
  let tenant = false;
  let reference: ForeignKeyTarget | null = null;

  if (chain === null) {
    unknowns.push(
      schemaUnknown('column "' + input.property + '" is not a column builder call', source),
    );
  } else if (chain.enumType !== null) {
    builder = chain.calleeName;
    type = chain.enumType;
    name = literalString(chain.args[0]) ?? input.property;
  } else if (chain.builder !== null && isKnownBuilder(chain.builder)) {
    builder = chain.builder.name;
    type = displayType(chain.builder.name, chain.args, context);
    tenant = chain.builder.pkg === "facilis-db" && chain.builder.name === "tenantColumn";
    const first = chain.args[0];
    if (first === undefined) {
      // `tenantColumn()` defaults its SQL name to tenant_id in @facilis.dev/db; other builders use the property key.
      name = tenant ? "tenant_id" : input.property;
    } else {
      const evaluated = staticString(first, context);
      if (evaluated.ok) {
        name = evaluated.value;
      } else {
        unknowns.push(
          schemaUnknown('SQL name of column "' + input.property + '" is not static', source),
        );
      }
    }
  } else {
    builder = chain.builder?.name ?? chain.calleeName;
    name = literalString(chain.args[0]) ?? input.property;
    unknowns.push(
      schemaUnknown('column builder "' + builder + '" is outside the documented DSL', source),
    );
  }

  let notNull = false;
  let primaryKey = false;
  let unique = false;
  let columnDefault: ColumnDefaultFact | null = null;
  let array = false;
  if (chain !== null) {
    for (const method of chain.methods) {
      switch (method.name) {
        case "notNull":
          notNull = true;
          break;
        case "primaryKey":
          primaryKey = true;
          break;
        case "unique":
          unique = true;
          break;
        case "default":
          columnDefault = readDefault(method.args[0], context);
          break;
        case "defaultRandom":
          columnDefault = { kind: "random", value: null };
          break;
        case "defaultNow":
          columnDefault = { kind: "now", value: null };
          break;
        case "array":
          array = true;
          break;
        case "references": {
          const result = readReference(method, context, input.file);
          reference = result.target;
          unknowns.push(...result.unknowns);
          break;
        }
        default:
          unknowns.push(
            schemaUnknown(
              'column method ".' + method.name + '" is outside the documented DSL',
              nodeRef(input.file, method.node),
            ),
          );
          break;
      }
    }
  }
  if (array && type !== "unknown") type += "[]";

  const column: ColumnFact = {
    property: input.property,
    name,
    builder,
    type,
    notNull,
    primaryKey,
    unique,
    default: columnDefault,
    source,
    unknown: unknowns,
  };
  return { column, reference, tenant, diagnostics: schemaDiagnostics(unknowns) };
}
