import { isSourceFile, readJson as parseJson } from "./json.ts";
import { parseModuleInfo, type ModuleInfo } from "./module-info.ts";
import { createPathResolver, normalizePath, type PathAlias } from "./path-resolver.ts";
import type { ParseError, Parser } from "./parser.ts";
import type { AstNode } from "./ast/node.ts";

export interface ProjectFile {
  readonly path: string;
  readonly source: string;
  readonly program: AstNode;
  readonly errors: readonly ParseError[];
  readonly module: ModuleInfo;
}

export interface Binding {
  readonly file: string;
  readonly name: string;
}

export interface ModuleGraph {
  readonly files: ReadonlyMap<string, ProjectFile>;
  /** Every input file (including JSON/tsconfig/package.json), path -> source. */
  readonly allFiles: ReadonlyMap<string, string>;
  readonly root: string;
  file(path: string): ProjectFile | undefined;
  resolve(from: string, specifier: string): string | null;
  resolveBinding(file: string, local: string): Binding | null;
  resolveExport(file: string, name: string): Binding | null;
  readJson(path: string): unknown;
}

export interface ModuleGraphInput {
  readonly files: ReadonlyMap<string, string>;
  readonly parser: Parser;
  readonly root?: string;
  readonly aliases?: readonly PathAlias[];
}

export function createModuleGraph(input: ModuleGraphInput): ModuleGraph {
  const root = normalizePath(input.root ?? "");
  const sources = new Map<string, string>();
  const files = new Map<string, ProjectFile>();
  for (const [rawPath, source] of input.files) {
    const path = normalizePath(rawPath);
    sources.set(path, source);
    if (!isSourceFile(path)) continue;
    const parsed = input.parser.parse(path, source);
    files.set(path, {
      path,
      source,
      program: parsed.program,
      errors: parsed.errors,
      module: parseModuleInfo(path, source, parsed.program),
    });
  }

  const resolver = createPathResolver({
    exists: (path) => sources.has(path),
    readJson: (path) => parseJson(sources, path),
    root,
    ...(input.aliases === undefined ? {} : { aliases: input.aliases }),
  });

  const resolveExport = (file: string, name: string, seen = new Set<string>()): Binding | null => {
    const key = file + "#" + name;
    if (seen.has(key)) return null;
    seen.add(key);
    const module = files.get(file);
    if (module === undefined) return null;
    const direct = module.module.exports.find((entry) => entry.exported === name);
    if (direct !== undefined) {
      if (direct.source !== null) {
        const target = resolver.resolve(file, direct.source);
        if (target === null) return null;
        if (direct.kind === "all") return resolveExport(target, "*", seen);
        return resolveExport(target, direct.imported ?? name, seen);
      }
      if (direct.local !== null) return resolveBinding(file, direct.local, seen);
      return { file, name };
    }
    for (const entry of module.module.exports) {
      if (entry.kind !== "all" || entry.source === null) continue;
      const target = resolver.resolve(file, entry.source);
      if (target !== null) {
        const found = resolveExport(target, name, new Set(seen));
        if (found !== null) return found;
      }
    }
    return null;
  };

  const resolveBinding = (
    file: string,
    local: string,
    seen = new Set<string>(),
  ): Binding | null => {
    const module = files.get(file);
    if (module === undefined) return null;
    const imported = module.module.imports.find((entry) => entry.local === local);
    if (imported === undefined) return { file, name: local };
    if (imported.kind === "namespace") return null;
    const target = resolver.resolve(file, imported.specifier);
    if (target === null) return null;
    return resolveExport(target, imported.imported ?? "default", new Set(seen));
  };

  return {
    files,
    allFiles: sources,
    root,
    file: (path) => files.get(normalizePath(path)),
    resolve: resolver.resolve,
    resolveBinding: (file, local) => resolveBinding(normalizePath(file), local),
    resolveExport: (file, name) => resolveExport(normalizePath(file), name),
    readJson: (path) => parseJson(sources, normalizePath(path)),
  };
}
