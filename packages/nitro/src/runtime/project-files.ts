import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { LocaleCatalogs, SchemaFileRevisionSource } from "@facilis/core";

/** SPEC §6.5 hashes db/schema.ts and the modules it imports (transitively). */
const SCHEMA_ENTRY = "db/schema.ts";
const LOCALES_DIR = "locales";
const MAX_SCHEMA_FILES = 32;
const MAX_SCHEMA_DEPTH = 8;
const RELATIVE_IMPORT = /(?:import|export)\s[^;]*?from\s*["'](\.[^"']+)["']/g;

export async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Follow db/schema.ts and its relative imports, returning path + content pairs.
 *
 * A static regex walk is enough here: the revision only needs the file set and its
 * bytes (SPEC §6.5), not a resolved module graph. Missing files are skipped so a
 * half-written schema never breaks the endpoint.
 */
export async function collectSchemaFiles(
  rootDir: string,
): Promise<readonly SchemaFileRevisionSource[]> {
  const files = new Map<string, string>();
  await visitSchemaFile(join(rootDir, SCHEMA_ENTRY), files, 0);
  return [...files.entries()]
    .map(([absolute, content]) => ({
      path: relative(rootDir, absolute).split(sep).join("/"),
      content,
    }))
    .toSorted((left, right) => left.path.localeCompare(right.path));
}

async function visitSchemaFile(
  filePath: string,
  files: Map<string, string>,
  depth: number,
): Promise<void> {
  if (depth > MAX_SCHEMA_DEPTH || files.has(filePath) || files.size >= MAX_SCHEMA_FILES) return;
  const content = await readTextFile(filePath);
  if (content === null) return;
  files.set(filePath, content);

  for (const match of content.matchAll(RELATIVE_IMPORT)) {
    const specifier = match[1];
    if (specifier === undefined) continue;
    // oxlint-disable-next-line no-await-in-loop -- recursion shares the dedupe Map; parallel visits would race on it.
    const resolved = await resolveRelativeModule(dirname(filePath), specifier);
    // oxlint-disable-next-line no-await-in-loop -- depth-first keeps the file-count cap deterministic.
    if (resolved !== null) await visitSchemaFile(resolved, files, depth + 1);
  }
}

async function resolveRelativeModule(fromDir: string, specifier: string): Promise<string | null> {
  const base = join(fromDir, specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, join(base, "index.ts")];
  for (const candidate of candidates) {
    // oxlint-disable-next-line no-await-in-loop -- stop at the first existing candidate.
    if ((await readTextFile(candidate)) !== null) return candidate;
  }
  return null;
}

/** Read `locales/*.json` into the manifest i18n.catalogs shape; invalid files are skipped. */
export async function collectLocaleCatalogs(rootDir: string): Promise<LocaleCatalogs> {
  const dir = join(rootDir, LOCALES_DIR);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return {};
  }

  const names = entries.filter((name) => name.endsWith(".json")).toSorted();
  const contents = await Promise.all(names.map((name) => readTextFile(join(dir, name))));
  const catalogs: Record<string, Record<string, string>> = {};
  for (const [index, name] of names.entries()) {
    const content = contents[index];
    if (content === null || content === undefined) continue;
    try {
      const messages = asStringRecord(JSON.parse(content));
      if (messages !== undefined) catalogs[name.slice(0, -".json".length)] = messages;
    } catch {
      // A malformed locale file must not break the manifest; it is simply absent.
    }
  }
  return catalogs;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") record[key] = entry;
  }
  return record;
}
