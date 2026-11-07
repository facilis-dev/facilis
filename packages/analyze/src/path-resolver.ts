/** Project-relative path handling and module specifier resolution (no Node APIs). */

export interface PathAlias {
  readonly prefix: string;
  readonly target: string;
}

export interface PathResolverInput {
  readonly exists: (path: string) => boolean;
  readonly readJson: (path: string) => unknown;
  readonly root: string;
  readonly aliases?: readonly PathAlias[];
}

export interface PathResolver {
  resolve(from: string, specifier: string): string | null;
  tryFile(path: string): string | null;
}

export const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
] as const;

export function normalizePath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

export function joinPath(base: string, relative: string): string {
  return normalizePath(base.length === 0 ? relative : base + "/" + relative);
}

function packageSpecifier(specifier: string): { pkg: string; subpath: string } {
  const parts = specifier.split("/");
  if (specifier.startsWith("@")) {
    return { pkg: parts.slice(0, 2).join("/"), subpath: parts.slice(2).join("/") };
  }
  return { pkg: parts[0] ?? specifier, subpath: parts.slice(1).join("/") };
}

function exportTargets(exports: unknown): string[] {
  if (typeof exports === "string") return [exports];
  if (Array.isArray(exports)) return exports.flatMap(exportTargets);
  if (typeof exports !== "object" || exports === null) return [];
  const record = exports as Record<string, unknown>;
  const out: string[] = [];
  for (const key of ["import", "default", "browser", "node"]) {
    if (key in record) out.push(...exportTargets(record[key]));
  }
  return out;
}

export function createPathResolver(input: PathResolverInput): PathResolver {
  const root = normalizePath(input.root);
  const aliases: PathAlias[] = [
    { prefix: "~/", target: root },
    { prefix: "~", target: root },
    ...(input.aliases ?? []),
  ];

  const tryFile = (path: string): string | null => {
    if (input.exists(path)) return path;
    for (const extension of SOURCE_EXTENSIONS) {
      if (input.exists(path + extension)) return path + extension;
    }
    for (const extension of SOURCE_EXTENSIONS) {
      const index = joinPath(path, "index" + extension);
      if (input.exists(index)) return index;
    }
    return null;
  };

  const resolvePackage = (specifier: string): string | null => {
    const { pkg, subpath } = packageSpecifier(specifier);
    const prefix = "node_modules/" + pkg;
    const packageJson = input.readJson(prefix + "/package.json");
    if (typeof packageJson !== "object" || packageJson === null) return null;
    const record = packageJson as Record<string, unknown>;
    if (subpath.length > 0) {
      const exports = record["exports"];
      if (typeof exports === "object" && exports !== null) {
        const entry = (exports as Record<string, unknown>)["./" + subpath];
        for (const target of exportTargets(entry)) {
          const resolved = tryFile(joinPath(prefix, target));
          if (resolved !== null) return resolved;
        }
      }
      return tryFile(joinPath(prefix, subpath));
    }
    const exports = record["exports"];
    if (typeof exports === "object" && exports !== null) {
      const entry = (exports as Record<string, unknown>)["."];
      for (const target of exportTargets(entry)) {
        const resolved = tryFile(joinPath(prefix, target));
        if (resolved !== null) return resolved;
      }
    }
    for (const target of ["main", "module"]) {
      const value = record[target];
      if (typeof value === "string") {
        const resolved = tryFile(joinPath(prefix, value));
        if (resolved !== null) return resolved;
      }
    }
    return tryFile(joinPath(prefix, "src/index.ts")) ?? tryFile(joinPath(prefix, "index.ts"));
  };

  const resolve = (from: string, rawSpecifier: string): string | null => {
    const specifier = rawSpecifier.trim();
    if (specifier.length === 0) return null;
    for (const alias of aliases) {
      if (specifier === alias.prefix || specifier.startsWith(alias.prefix)) {
        const rest = specifier.slice(alias.prefix.length);
        const target = alias.target.length === 0 ? rest : joinPath(alias.target, rest);
        const resolved = tryFile(target);
        if (resolved !== null) return resolved;
      }
    }
    if (specifier.startsWith(".")) return tryFile(joinPath(dirname(from), specifier));
    if (specifier.startsWith("/")) return tryFile(normalizePath(specifier));
    return resolvePackage(specifier);
  };

  return { resolve, tryFile };
}
