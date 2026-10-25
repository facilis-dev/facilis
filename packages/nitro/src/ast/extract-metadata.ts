import type { ManifestWarning } from "@facilis/core";
import {
  asNode,
  callArguments,
  isCallTo,
  isAstNode,
  propertyName,
  propertyValue,
  type AstNode,
} from "./ast.ts";
import { evaluateStatic } from "./static-eval.ts";
import type { MetadataField } from "../types.ts";

/** Keys of AuthorizedHandlerConfig the AST pass reads (SPEC §7.4). */
const STATIC_FIELDS: readonly MetadataField[] = [
  "description",
  "permission",
  "dbTables",
  "dbColumns",
];

export interface ExtractedRouteMetadata {
  permission?: string | readonly string[];
  dbTables?: readonly string[];
  dbColumns?: readonly string[];
  description?: string;
  unresolved: MetadataField[];
  warnings: ManifestWarning[];
}

interface ExtractOptions {
  /** Project-relative path used in warning messages and RouteMeta.sourceFile. */
  sourceFile: string;
}

/**
 * Extract route metadata from a parsed program without executing it.
 *
 * Primary shape: `export default defineAuthorizedHandler({ ... }, handler)`.
 * Fallback shape: a top-level `defineRouteMeta({ openAPI: { ... } })` (Nitro's own
 * scanner sees these natively; the fallback only keeps manifests complete).
 *
 * Returns undefined when the file declares neither shape.
 */
export function extractRouteMetadata(
  program: AstNode,
  options: ExtractOptions,
): ExtractedRouteMetadata | undefined {
  const wrapper = findDefaultExportCall(program, "defineAuthorizedHandler");
  if (wrapper) return extractFromWrapper(wrapper, options);
  const routeMeta = findTopLevelCall(program, "defineRouteMeta");
  if (routeMeta) return extractFromRouteMeta(routeMeta, options);
  return undefined;
}

function statementBody(program: AstNode): AstNode[] {
  const body = program.body;
  return Array.isArray(body) ? body.filter(isAstNode) : [];
}

function findDefaultExportCall(program: AstNode, calleeName: string): AstNode | undefined {
  for (const statement of statementBody(program)) {
    if (statement.type !== "ExportDefaultDeclaration") continue;
    const candidate = unwrapCall(statement.declaration, calleeName);
    if (candidate) return candidate;
  }
  return undefined;
}

function findTopLevelCall(program: AstNode, calleeName: string): AstNode | undefined {
  for (const statement of statementBody(program)) {
    if (statement.type !== "ExpressionStatement") continue;
    const candidate = unwrapCall(statement.expression, calleeName);
    if (candidate) return candidate;
  }
  return undefined;
}

function unwrapCall(value: unknown, calleeName: string): AstNode | undefined {
  let node = asNode(value);
  while (
    node &&
    (node.type === "TSAsExpression" ||
      node.type === "TSSatisfiesExpression" ||
      node.type === "ParenthesizedExpression" ||
      node.type === "TSNonNullExpression")
  ) {
    node = asNode(node.expression);
  }
  return node && isCallTo(node, calleeName) ? node : undefined;
}

function extractFromWrapper(call: AstNode, options: ExtractOptions): ExtractedRouteMetadata {
  const config = callArguments(call)[0];
  if (!config || config.type !== "ObjectExpression") {
    return unresolvedAll(
      [
        `defineAuthorizedHandler config is not an object literal (got "${config?.type ?? "nothing"}")`,
      ],
      options,
    );
  }
  const extracted: ExtractedRouteMetadata = { unresolved: [], warnings: [] };
  for (const property of objectEntries(config)) {
    const field = propertyName(property);
    if (field === undefined) {
      extracted.warnings.push(
        warn("config property", "computed key or spread is not static", options),
      );
      continue;
    }
    if (!isStaticField(field)) continue; // body/query/params are Zod schemas: irrelevant here.
    const value = evaluateStatic(propertyValue(property));
    if (!value.ok) {
      extracted.unresolved.push(field);
      extracted.warnings.push(warn(field, value.reason, options));
      continue;
    }
    assignField(extracted, field, value.value, options);
  }
  return extracted;
}

function extractFromRouteMeta(call: AstNode, options: ExtractOptions): ExtractedRouteMetadata {
  const argument = callArguments(call)[0];
  const value = evaluateStatic(argument);
  if (!value.ok)
    return unresolvedAll([`defineRouteMeta argument is not static: ${value.reason}`], options);
  const openAPI = (value.value as { openAPI?: unknown } | undefined)?.openAPI;
  if (!openAPI || typeof openAPI !== "object")
    return unresolvedAll(["defineRouteMeta has no static openAPI object"], options);

  const extracted: ExtractedRouteMetadata = { unresolved: [], warnings: [] };
  const record = openAPI as Record<string, unknown>;
  if ("description" in record) assignField(extracted, "description", record.description, options);
  if ("x-permission" in record)
    assignField(extracted, "permission", record["x-permission"], options);
  if ("x-db-tables" in record) assignField(extracted, "dbTables", record["x-db-tables"], options);
  if ("x-db-columns" in record)
    assignField(extracted, "dbColumns", record["x-db-columns"], options);
  return extracted;
}

function objectEntries(node: AstNode): AstNode[] {
  const properties = node.properties;
  return Array.isArray(properties) ? properties.filter(isAstNode) : [];
}

function isStaticField(field: string): field is MetadataField {
  return (STATIC_FIELDS as readonly string[]).includes(field);
}

function assignField(
  target: ExtractedRouteMetadata,
  field: MetadataField,
  value: unknown,
  options: ExtractOptions,
): void {
  switch (field) {
    case "description":
      if (typeof value === "string") target.description = value;
      else reject(target, field, "expected a string literal", options);
      return;
    case "permission": {
      const permission = stringOrStringArray(value);
      if (permission === undefined)
        reject(target, field, "expected a string or string[] literal", options);
      else target.permission = permission;
      return;
    }
    case "dbTables":
    case "dbColumns": {
      const columns = stringArray(value);
      if (columns === undefined) reject(target, field, "expected a string[] literal", options);
      else target[field] = columns;
      return;
    }
  }
}

function reject(
  target: ExtractedRouteMetadata,
  field: MetadataField,
  reason: string,
  options: ExtractOptions,
): void {
  target.unresolved.push(field);
  target.warnings.push(warn(field, reason, options));
}

function unresolvedAll(
  reasons: readonly string[],
  options: ExtractOptions,
): ExtractedRouteMetadata {
  return {
    unresolved: [...STATIC_FIELDS],
    warnings: reasons.map((reason) => warn("config", reason, options)),
  };
}

function warn(field: string, reason: string, options: ExtractOptions): ManifestWarning {
  return {
    code: "meta-not-static",
    message: `Route metadata "${field}" in ${options.sourceFile} is not statically resolvable: ${reason}`,
    section: "routes",
    sourceFile: options.sourceFile,
  };
}

function stringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.every((item): item is string => typeof item === "string") ? value : undefined;
}

function stringOrStringArray(value: unknown): string | readonly string[] | undefined {
  if (typeof value === "string") return value;
  return stringArray(value);
}
