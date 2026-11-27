import type { AstNode } from "../ast/node.ts";
import type { ModuleGraph, ProjectFile } from "../module-graph.ts";
import { sourceRef } from "../source.ts";
import type { SourceRef, UnknownFact } from "../types.ts";

/** Helpers shared by the surface passes (the 300-line split). */
export function sortedFiles(graph: ModuleGraph): ProjectFile[] {
  return [...graph.files.values()].toSorted((left, right) => left.path.localeCompare(right.path));
}

export function refOf(file: ProjectFile, node: AstNode | undefined): SourceRef {
  return sourceRef(file.path, file.lines, typeof node?.start === "number" ? node.start : 0);
}

export function unknownFact(code: string, reason: string, source: SourceRef): UnknownFact {
  return { code, reason, source };
}

/** Test modules are not shipped surface: a test may import a factory to arrange a fixture. */
export function isTestFile(path: string): boolean {
  return /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path);
}
