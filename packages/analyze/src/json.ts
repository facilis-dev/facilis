import { isAstNode } from "./ast/node.ts";

/** Parse a JSON file from the project file map; null when absent or malformed. */
export function readJson(files: ReadonlyMap<string, string>, path: string): unknown {
  const source = files.get(path);
  if (source === undefined) return null;
  try {
    return JSON.parse(source) as unknown;
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Module source extensions the analyzer can parse. */
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

export function isSourceFile(path: string): boolean {
  return SOURCE_EXTENSIONS.some((extension) => path.endsWith(extension));
}

export { isAstNode };
