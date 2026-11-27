/**
 * Project-level surface facts (D-226): extensions, forbidden imports and dynamic code.
 *
 * These are the capabilities that are not routes: a Nitro plugin runs before any route, a
 * db factory import bypasses the declarative client, and dynamic code has no static shape.
 * They are resolved here, once, so the build gate, the IDE and the release export read the
 * same facts instead of re-scanning the project.
 */
import { callArguments, identifierName, unwrapExpression, type AstNode } from "../ast/node.ts";
import { error } from "../diagnostics.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import type { Diagnostic, FileFacts, RouteFact, UnknownFact } from "../types.ts";
import type {
  ForbiddenImportFact,
  SecuritySurfaceFacts,
  ServerExtensionFact,
  ServerExtensionKind,
  SurfaceClass,
  SurfaceDeclarationFact,
  SurfaceFact,
} from "../types-surface.ts";
import { defaultExportExpression, readConfirmed, readStaticObject } from "./static-read.ts";
import { buildDynamicCodeFacts } from "./surface-dynamic.ts";
import { isTestFile, refOf, sortedFiles, unknownFact } from "./surface-shared.ts";

const CORE_SPECIFIER = "@facilis.dev/core";
const DB_SPECIFIER = "@facilis.dev/db";
const EXTENSION_DIRS: ReadonlyArray<[string, ServerExtensionKind]> = [
  ["server/plugins/", "plugin"],
  ["server/middleware/", "middleware"],
  ["server/modules/", "module"],
  ["server/tasks/", "task"],
];
const FORBIDDEN_DB_IMPORTS = /^(?:createDb|runAs[A-Za-z]*|ensure[A-Za-z]*)$/;

function extensionKind(path: string): ServerExtensionKind | null {
  for (const [dir, kind] of EXTENSION_DIRS) {
    if (path.startsWith(dir)) return kind;
  }
  return null;
}

/** Read `{ reason, confirmed }` from the defineServerExtension first argument. */
function extensionDeclaration(
  graph: ModuleGraph,
  file: ProjectFile,
  call: AstNode,
): { reason: string | null; confirmed?: { at: string; by: string }; unknown: UnknownFact[] } {
  const context = { graph, file: file.path };
  const object = readStaticObject(callArguments(call)[0], context, {
    code: "surface-static",
    report: false,
  });
  const unknown = [...object.unknown];
  const reasonField = object.fields.get("reason");
  let reason: string | null = null;
  if (
    reasonField?.ok === true &&
    typeof reasonField.value === "string" &&
    reasonField.value.trim().length > 0
  ) {
    reason = reasonField.value.trim();
  } else {
    unknown.push(
      unknownFact(
        "surface-undeclared",
        "defineServerExtension requires a non-empty reason",
        refOf(file, call),
      ),
    );
  }
  const confirmedField = object.fields.get("confirmed");
  const confirmed = confirmedField?.ok === true ? readConfirmed(confirmedField.value) : undefined;
  return { reason, ...(confirmed === undefined ? {} : { confirmed }), unknown };
}

function extensionFacts(graph: ModuleGraph): {
  extensions: ServerExtensionFact[];
  diagnostics: Diagnostic[];
} {
  const extensions: ServerExtensionFact[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const file of sortedFiles(graph)) {
    const kind = extensionKind(file.path);
    if (kind === null || file.path.startsWith("node_modules/")) continue;
    if (file.path.endsWith(".test.ts")) continue;
    const expression = defaultExportExpression(file);
    const ref = refOf(file, expression ?? undefined);
    let surface: SurfaceFact;
    if (expression?.type !== "CallExpression") {
      surface = {
        class: "undeclared",
        declarations: [],
        source: ref,
        unknown: [
          unknownFact(
            "surface-undeclared",
            "server extension must export defineServerExtension({ reason }, value)",
            ref,
          ),
        ],
      };
      diagnostics.push(error("surface-undeclared", surface.unknown[0]!.reason, ref));
    } else {
      const callee = unwrapExpression(expression.callee);
      const name = callee?.type === "Identifier" ? identifierName(callee) : undefined;
      const imported = file.module.imports.find((entry) => entry.local === name);
      if (imported?.specifier !== CORE_SPECIFIER || imported.imported !== "defineServerExtension") {
        const reason =
          "server extension must be wrapped in defineServerExtension from @facilis.dev/core";
        surface = {
          class: "undeclared",
          declarations: [],
          source: ref,
          unknown: [unknownFact("surface-undeclared", reason, ref)],
        };
        diagnostics.push(error("surface-undeclared", reason, ref));
      } else {
        const declaration = extensionDeclaration(graph, file, expression);
        const declarations: SurfaceDeclarationFact[] =
          declaration.reason === null
            ? []
            : [
                {
                  kind: "server-extension",
                  reason: declaration.reason,
                  source: ref,
                  ...(declaration.confirmed === undefined
                    ? {}
                    : { confirmed: declaration.confirmed }),
                },
              ];
        const declared = declaration.reason !== null;
        surface = {
          class: declared ? "declared" : "undeclared",
          declarations,
          source: ref,
          unknown: declaration.unknown,
        };
        diagnostics.push(
          ...declaration.unknown.map((item) => error(item.code, item.reason, item.source)),
        );
      }
    }
    extensions.push({ file: file.path, kind, surface });
  }
  return { extensions, diagnostics };
}

function forbiddenImports(fileFacts: readonly FileFacts[]): ForbiddenImportFact[] {
  const facts: ForbiddenImportFact[] = [];
  for (const file of fileFacts) {
    if (file.path.startsWith("node_modules/") || isTestFile(file.path)) continue;
    for (const imported of file.imports) {
      if (imported.specifier !== DB_SPECIFIER) continue;
      const name = imported.imported;
      const forbidden =
        name === null && imported.kind === "namespace"
          ? "*"
          : name !== null && FORBIDDEN_DB_IMPORTS.test(name)
            ? name
            : null;
      if (forbidden === null) continue;
      facts.push({
        file: file.path,
        specifier: imported.specifier,
        imported: forbidden,
        source: imported.source,
      });
    }
  }
  return facts;
}

/** Build the project-level surface facts plus the class summary used by the artifact. */
export function buildSecuritySurfaceFacts(
  graph: ModuleGraph,
  fileFacts: readonly FileFacts[],
  routes: readonly RouteFact[],
): { surface: SecuritySurfaceFacts; diagnostics: Diagnostic[] } {
  const extensions = extensionFacts(graph);
  const dynamic = buildDynamicCodeFacts(graph);
  const imports = forbiddenImports(fileFacts);
  const counts: Record<SurfaceClass, number> = {
    standard: 0,
    declared: 0,
    undeclared: 0,
    unknown: 0,
  };
  for (const route of routes) counts[route.surface.class] += 1;
  for (const extension of extensions.extensions) counts[extension.surface.class] += 1;
  for (const code of dynamic.facts) counts[code.surface.class] += 1;
  counts.undeclared += imports.length;
  // The top-level bucket carries the unreadable facts of the declared sites; it is not a
  // synonym for "not standard", which the per-site class already says.
  const unknown = [
    ...routes.flatMap((route) => route.surface.unknown),
    ...extensions.extensions.flatMap((extension) => extension.surface.unknown),
    ...dynamic.facts.flatMap((entry) => entry.surface.unknown),
  ].toSorted(
    (left, right) =>
      left.source.file.localeCompare(right.source.file) ||
      left.source.line - right.source.line ||
      left.code.localeCompare(right.code),
  );
  return {
    surface: {
      extensions: extensions.extensions,
      forbiddenImports: imports,
      dynamicCode: dynamic.facts,
      unknown,
      summary: { ...counts },
    },
    diagnostics: [...extensions.diagnostics, ...dynamic.diagnostics],
  };
}