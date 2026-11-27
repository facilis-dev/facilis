/**
 * Project-level surface facts (D-226): extensions, forbidden imports and dynamic code.
 *
 * These are the capabilities that are not routes: a Nitro plugin runs before any route, a
 * db factory import bypasses the declarative client, and dynamic code has no static shape.
 * They are resolved here, once, so the build gate, the IDE and the release export read the
 * same facts instead of re-scanning the project.
 */
import {
  callArguments,
  identifierName,
  literalString,
  unwrapExpression,
  type AstNode,
} from "../ast/node.ts";
import { walk } from "../ast/walk.ts";
import { error } from "../diagnostics.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import { sourceRef } from "../source.ts";
import type { Diagnostic, FileFacts, RouteFact, SourceRef, UnknownFact } from "../types.ts";
import type {
  DynamicCodeFact,
  DynamicCodeForm,
  ForbiddenImportFact,
  SecuritySurfaceFacts,
  ServerExtensionFact,
  ServerExtensionKind,
  SurfaceClass,
  SurfaceDeclarationFact,
  SurfaceFact,
} from "../types-surface.ts";
import { defaultExportExpression, readStaticObject } from "./static-read.ts";

const CORE_SPECIFIER = "@facilis.dev/core";
const DB_SPECIFIER = "@facilis.dev/db";
const EXTENSION_DIRS: ReadonlyArray<[string, ServerExtensionKind]> = [
  ["server/plugins/", "plugin"],
  ["server/middleware/", "middleware"],
  ["server/modules/", "module"],
  ["server/tasks/", "task"],
];
const FORBIDDEN_DB_IMPORTS = /^(?:createDb|runAs[A-Za-z]*|ensure[A-Za-z]*)$/;
const DYNAMIC_MARKER = /^dynamic-code(?::|\s)(.*)$/;

function sortedFiles(graph: ModuleGraph): ProjectFile[] {
  return [...graph.files.values()].toSorted((left, right) => left.path.localeCompare(right.path));
}

function extensionKind(path: string): ServerExtensionKind | null {
  for (const [dir, kind] of EXTENSION_DIRS) {
    if (path.startsWith(dir)) return kind;
  }
  return null;
}

function refOf(file: ProjectFile, node: AstNode | undefined): SourceRef {
  return sourceRef(file.path, file.lines, typeof node?.start === "number" ? node.start : 0);
}

function unknownFact(code: string, reason: string, source: SourceRef): UnknownFact {
  return { code, reason, source };
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
  return { reason, unknown };
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
            : [{ kind: "server-extension", reason: declaration.reason, source: ref }];
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

/** Test modules are not shipped surface: a test may import a factory to arrange a fixture. */
function isTestFile(path: string): boolean {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
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

/** True when the dynamic site carries a `// dynamic-code: reason` marker above it. */
function dynamicMarker(file: ProjectFile, node: AstNode): string | null {
  if (file.comments === null) return null;
  const line = file.lines.lineAt(typeof node.start === "number" ? node.start : 0);
  for (const comment of file.comments) {
    if (file.lines.lineAt(comment.end) !== line - 1) continue;
    const match = DYNAMIC_MARKER.exec(comment.value.trim());
    if (match === null) continue;
    const reason = (match[1] ?? "").trim();
    if (reason.length > 0) return reason;
  }
  return null;
}

function dynamicForm(node: AstNode): DynamicCodeForm | null {
  if (node.type === "CallExpression" && identifierName(node.callee) === "eval") return "eval";
  if (node.type === "NewExpression" && identifierName(node.callee) === "Function") {
    return "new-function";
  }
  if (node.type === "ImportExpression" && literalString(node.source) === undefined) {
    return "computed-import";
  }
  return null;
}

function dynamicCodeFacts(graph: ModuleGraph): {
  facts: DynamicCodeFact[];
  diagnostics: Diagnostic[];
} {
  const facts: DynamicCodeFact[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const file of sortedFiles(graph)) {
    if (file.path.startsWith("node_modules/") || isTestFile(file.path)) continue;
    walk(file.program, (node) => {
      const form = dynamicForm(node);
      if (form === null) return;
      const ref = refOf(file, node);
      const reason = dynamicMarker(file, node);
      const declarations: SurfaceDeclarationFact[] =
        reason === null ? [] : [{ kind: "dynamic-code", reason, source: ref }];
      const surface: SurfaceFact = {
        class: reason === null ? "undeclared" : "declared",
        declarations,
        source: ref,
        unknown:
          reason === null
            ? [
                unknownFact(
                  "surface-undeclared",
                  "dynamic code must be declared with a // dynamic-code: <reason> marker (D-226)",
                  ref,
                ),
              ]
            : [],
      };
      if (reason === null) {
        diagnostics.push(error("surface-undeclared", surface.unknown[0]!.reason, ref));
      }
      facts.push({ file: file.path, form, surface });
    });
  }
  return { facts, diagnostics };
}

/** Build the project-level surface facts plus the class summary used by the artifact. */
export function buildSecuritySurfaceFacts(
  graph: ModuleGraph,
  fileFacts: readonly FileFacts[],
  routes: readonly RouteFact[],
): { surface: SecuritySurfaceFacts; diagnostics: Diagnostic[] } {
  const extensions = extensionFacts(graph);
  const dynamic = dynamicCodeFacts(graph);
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
  return {
    surface: {
      extensions: extensions.extensions,
      forbiddenImports: imports,
      dynamicCode: dynamic.facts,
      unknown: [],
      summary: { ...counts },
    },
    diagnostics: [...extensions.diagnostics, ...dynamic.diagnostics],
  };
}
