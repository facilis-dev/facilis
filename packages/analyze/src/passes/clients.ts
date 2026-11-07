/**
 * Client consumers -> PageFacts and page→route edges (§3.4 of the AST DSL contract).
 *
 * Exactly one transport is sanctioned (`api()` from `src/lib/api.ts` by default): the
 * transport export is resolved through imports (aliases and namespace imports included) and
 * every other network call in `src/**` is a `client-transport` error. The transport module
 * itself is the only place allowed to call `fetch`, so it is not scanned as a consumer.
 */

import {
  callArguments,
  identifierName,
  memberName,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import { walk } from "../ast/walk.ts";
import { error, warning } from "../diagnostics.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import type { StaticContext } from "../static-eval.ts";
import type {
  Diagnostic,
  HttpMethod,
  PageFact,
  PageKind,
  RouteCallFact,
  RouteFact,
  SourceRef,
  UnknownFact,
} from "../types.ts";
import { extractPathExpression, matchRouteIds } from "./path-expression.ts";
import {
  projectPath,
  readStaticObject,
  relativePath,
  refOf,
  sortDiagnostics,
} from "./static-read.ts";

const SRC_DIR = "src/";
const HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
  "TRACE",
  "CONNECT",
]);
const NETWORK_CALLEES = new Set(["fetch", "axios", "ky", "got"]);

export interface TransportSpec {
  /** Project-relative module, e.g. `src/lib/api.ts`. */
  readonly module: string;
  /** Exported function that performs API calls, e.g. `api`. */
  readonly exportName: string;
}

export interface ClientResult {
  readonly pages: readonly PageFact[];
  readonly diagnostics: readonly Diagnostic[];
}

interface TransportBindings {
  readonly names: ReadonlySet<string>;
  readonly namespaces: ReadonlySet<string>;
}

function transportBindings(
  graph: ModuleGraph,
  file: ProjectFile,
  transportPath: string,
  exportName: string,
): TransportBindings {
  const names = new Set<string>();
  const namespaces = new Set<string>();
  for (const imported of file.module.imports) {
    if (graph.resolve(file.path, imported.specifier) !== transportPath) continue;
    if (imported.kind === "namespace") namespaces.add(imported.local);
    else if ((imported.imported ?? "default") === exportName) names.add(imported.local);
  }
  return { names, namespaces };
}

function isTransportCall(call: AstNode, bindings: TransportBindings, exportName: string): boolean {
  const callee = unwrapExpression(call.callee);
  const direct = identifierName(callee);
  if (direct !== undefined) return bindings.names.has(direct);
  if (callee?.type !== "MemberExpression") return false;
  const objectName = identifierName(unwrapExpression(callee.object));
  return (
    objectName !== undefined &&
    bindings.namespaces.has(objectName) &&
    memberName(callee) === exportName
  );
}

/** Name of a network call that is not the transport, or null when the node is not one. */
function networkCallName(node: AstNode): string | null {
  if (node.type === "NewExpression") {
    return identifierName(unwrapExpression(node.callee)) === "XMLHttpRequest"
      ? "XMLHttpRequest"
      : null;
  }
  if (node.type !== "CallExpression") return null;
  const callee = unwrapExpression(node.callee);
  const direct = identifierName(callee);
  if (direct !== undefined && NETWORK_CALLEES.has(direct)) return direct;
  if (callee?.type !== "MemberExpression") return null;
  const objectName = identifierName(unwrapExpression(callee.object));
  return objectName !== undefined && NETWORK_CALLEES.has(objectName) ? objectName : null;
}

interface MethodResult {
  readonly method: HttpMethod;
  readonly unknown: UnknownFact | null;
}

/** The request method comes from the second argument's static `method`, else GET. */
function requestMethod(
  init: AstNode | undefined,
  context: StaticContext,
  callRef: SourceRef,
): MethodResult {
  if (init === undefined) return { method: "GET", unknown: null };
  const object = readStaticObject(init, context, { code: "page-path-static", report: false });
  const field = object.fields.get("method");
  if (field !== undefined && field.ok && typeof field.value === "string") {
    const method = field.value.toUpperCase();
    if (HTTP_METHODS.has(method)) return { method: method as HttpMethod, unknown: null };
  }
  // An unreadable options object hides the method; defaulting silently could produce a wrong
  // page→route edge, so the assumption is recorded as unknown.
  const unknown: UnknownFact | null =
    field === undefined && object.unknown.length === 0
      ? null
      : {
          code: "page-path-static",
          reason: "the request method cannot be read statically; assuming GET",
          source: callRef,
        };
  return { method: "GET", unknown };
}

function pageKind(relative: string): PageKind {
  if (relative.startsWith("src/pages/")) return "page";
  if (relative.startsWith("src/components/")) return "component";
  if (relative.startsWith("src/lib/")) return "lib";
  return "other";
}

function scanPage(
  graph: ModuleGraph,
  file: ProjectFile,
  routes: readonly RouteFact[],
  transportPath: string,
  exportName: string,
): { page: PageFact; diagnostics: readonly Diagnostic[] } {
  const context: StaticContext = { graph, file: file.path };
  const bindings = transportBindings(graph, file, transportPath, exportName);
  const calls: RouteCallFact[] = [];
  const diagnostics: Diagnostic[] = [];

  walk(file.program, (node) => {
    if (node.type !== "CallExpression" && node.type !== "NewExpression") return;
    const transport = node.type === "CallExpression" && isTransportCall(node, bindings, exportName);
    const network = transport ? null : networkCallName(node);
    if (!transport && network === null) return;

    const callRef = refOf(context, node);
    const args = node.type === "CallExpression" ? callArguments(node) : [];
    const extracted = extractPathExpression(args[0], context, node, "page-path-static");
    const method = requestMethod(args[1], context, callRef);
    const unknown: UnknownFact[] = [...extracted.unknown];
    if (method.unknown !== null) unknown.push(method.unknown);

    if (transport && extracted.path === null && extracted.staticPrefix === null) {
      diagnostics.push(
        warning("page-path-static", "the API path cannot be resolved statically", callRef),
      );
    }
    if (!transport && network !== null) {
      const reason = network + " outside the sanctioned transport module is not allowed";
      unknown.push({ code: "client-transport", reason, source: callRef });
      diagnostics.push(error("client-transport", reason, callRef));
    }

    calls.push({
      expression: extracted.expression,
      kind: extracted.kind,
      staticPrefix: extracted.staticPrefix,
      matchedRouteIds: matchRouteIds(routes, extracted.path, extracted.staticPrefix, method.method),
      source: callRef,
      unknown,
    });
  });

  const page: PageFact = {
    path: file.path,
    kind: pageKind(relativePath(graph.root, file.path)),
    calls,
    source: { file: file.path, line: 1 },
    unknown: [],
  };
  return { page, diagnostics };
}

/** Map client files to the routes they call. */
export function buildPageFacts(
  graph: ModuleGraph,
  routes: readonly RouteFact[],
  transport: TransportSpec,
): ClientResult {
  const transportPath = projectPath(graph.root, transport.module);
  const files = [...graph.files.values()]
    .filter((file) => {
      const relative = relativePath(graph.root, file.path);
      if (!relative.startsWith(SRC_DIR)) return false;
      if (relative.includes(".test.")) return false;
      return file.path !== transportPath;
    })
    .toSorted((left, right) => left.path.localeCompare(right.path));
  const pages: PageFact[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const file of files) {
    const scanned = scanPage(graph, file, routes, transportPath, transport.exportName);
    pages.push(scanned.page);
    diagnostics.push(...scanned.diagnostics);
  }
  return { pages, diagnostics: sortDiagnostics(diagnostics) };
}
