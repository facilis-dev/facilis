import { identifierName, literalString, type AstNode } from "../ast/node.ts";
import { walk } from "../ast/walk.ts";
import { error } from "../diagnostics.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import type { Diagnostic } from "../types.ts";
import type {
  DynamicCodeFact,
  DynamicCodeForm,
  SurfaceDeclarationFact,
  SurfaceFact,
} from "../types-surface.ts";
import { isTestFile, refOf, sortedFiles, unknownFact } from "./surface-shared.ts";

const DYNAMIC_MARKER = /^dynamic-code(?::|\s)(.*)$/;

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

/** Build the dynamic-code facts (declared by a marker, or blocked). */
export function buildDynamicCodeFacts(graph: ModuleGraph): {
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
        const unknown = surface.unknown[0];
        if (unknown !== undefined) {
          diagnostics.push(error("surface-undeclared", unknown.reason, ref));
        }
      }
      facts.push({ file: file.path, form, surface });
    });
  }
  return { facts, diagnostics };
}
