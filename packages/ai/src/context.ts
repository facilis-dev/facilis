/**
 * Assembles the typed project context the validator rules read.
 *
 * The caller supplies raw material only (file list, a few sources, the live manifest);
 * this module parses it once. Sources are authoritative — they are the code — and the
 * manifest fills what the code cannot say (routes, registered blocks, the live schema
 * including framework tables). Everything is browser-safe.
 */

import { parseConfigSource } from "./config-facts.ts";
import { factsFromManifest } from "./manifest-facts.ts";
import { normalizeProjectPath } from "./paths.ts";
import { parseSchemaSource } from "./schema-facts.ts";
import type {
  BlockFacts,
  ConfigFacts,
  ImportAlias,
  ProjectContext,
  ProjectContextInput,
  RouteFacts,
  TableFacts,
} from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSources(
  sources: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [path, content] of Object.entries(sources ?? {})) {
    normalized[normalizeProjectPath(path)] = content;
  }
  return normalized;
}

function mergeConfig(primary: ConfigFacts, fallback: ConfigFacts | null): ConfigFacts {
  if (fallback === null) return primary;
  const auth = primary.hasAuth ? primary : fallback;
  return {
    ...primary,
    parsed: primary.parsed || fallback.parsed,
    hasAuth: auth.hasAuth,
    permissions: auth.permissions,
    roles: auth.roles,
    defaultRole: primary.defaultRole ?? fallback.defaultRole,
    defaultLocale: primary.defaultLocale ?? fallback.defaultLocale,
    locales: primary.locales.length > 0 ? primary.locales : fallback.locales,
    blocksPackages:
      primary.blocksPackages.length > 0 ? primary.blocksPackages : fallback.blocksPackages,
    ...(primary.parsed
      ? {}
      : {
          migrationsDir: fallback.migrationsDir,
          tenantColumns: fallback.tenantColumns,
          ownerColumns: fallback.ownerColumns,
        }),
  };
}

/** Code tables win over manifest tables with the same name; both are kept otherwise. */
function mergeTables(
  manifestTables: readonly TableFacts[],
  codeTables: readonly TableFacts[],
): TableFacts[] {
  const merged = new Map<string, TableFacts>();
  for (const table of manifestTables) merged.set(table.name, table);
  for (const table of codeTables) merged.set(table.name, table);
  return [...merged.values()];
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Installed bare specifiers from the project's package.json. */
function packagesFromSource(source: string | undefined): string[] {
  if (source === undefined) return [];
  const parsed = parseJsonRecord(source);
  if (parsed === null) return [];
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    const section = parsed[field];
    if (!isRecord(section)) continue;
    for (const name of Object.keys(section)) names.add(name);
  }
  return [...names];
}

/** `tsconfig.json` `paths` aliases, normalized to project-relative targets. */
function aliasesFromSource(source: string | undefined): ImportAlias[] {
  const aliases: ImportAlias[] = [{ prefix: "~/", target: "" }];
  if (source === undefined) return aliases;
  const parsed = parseJsonRecord(source);
  const options =
    parsed !== null && isRecord(parsed.compilerOptions) ? parsed.compilerOptions : null;
  const paths = options !== null && isRecord(options.paths) ? options.paths : null;
  if (paths === null) return aliases;
  for (const [pattern, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;
    const target = targets[0];
    if (typeof target !== "string") continue;
    const prefix = pattern.endsWith("*") ? pattern.slice(0, -1) : pattern;
    const resolved = target.replace(/^\.\//, "").replace(/\*$/, "").replace(/\/$/, "");
    aliases.push({ prefix, target: resolved });
  }
  return aliases;
}

/** Build the typed context, preferring code over the live manifest. */
export function buildProjectContext(input: ProjectContextInput): ProjectContext {
  const sources = normalizeSources(input.sources);
  const manifest = factsFromManifest(input.manifest);
  const sourceConfig = parseConfigSource(sources["facilis.config.ts"] ?? "");
  const config = mergeConfig(sourceConfig, manifest.config);
  const codeTables = parseSchemaSource(sources["db/schema.ts"] ?? "", config);
  const configTableNames = new Set(codeTables.map((table) => table.name));
  const manifestTables = manifest.tables.filter((table) => !configTableNames.has(table.name));
  const catalog = parseJsonRecord(sources["locales/en.json"] ?? "");
  const locales: Record<string, string> = { ...manifest.locales };
  if (catalog !== null) {
    for (const [key, text] of Object.entries(catalog)) {
      if (typeof text === "string") locales[key] = text;
    }
  }
  const blocks: BlockFacts[] = manifest.blocks;
  const routes: RouteFacts[] = manifest.routes;
  return {
    files: input.files.map(normalizeProjectPath).filter((path) => path.length > 0),
    sources,
    config,
    schema: {
      parsed: sourceConfig.parsed || manifest.tables.length > 0,
      tables: mergeTables(manifestTables, codeTables),
    },
    locales,
    blocks,
    routes,
    packages: input.packages ?? packagesFromSource(sources["package.json"]),
    aliases: input.aliases ?? aliasesFromSource(sources["tsconfig.json"]),
  };
}
