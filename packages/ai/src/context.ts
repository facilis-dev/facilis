/**
 * Assembles the typed project context the validator rules read.
 *
 * After D-092 this is a pure mapping, not a parser: the caller hands in the effective
 * (post-patch) Analysis and optionally the pre-patch one, and the facts are projected onto
 * the validator's contract. The only bytes read here are package.json and tsconfig.json
 * (installed packages and path aliases), which the analyzer does not model as facts.
 * Everything is browser-safe.
 */

import { factsFromManifest } from "./manifest-facts.ts";
import { normalizeProjectPath, SCHEMA_PATH } from "./paths.ts";
import type {
  Analysis,
  BlockFacts,
  ConfigFacts,
  ImportAlias,
  ProjectContext,
  ProjectContextInput,
  RouteFact,
  TableFact,
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

/**
 * The default-locale catalogue: the analyzer's facts first, the manifest only underneath
 * as a fallback. `analysis.locales.en` is the generated project's source of truth; when
 * the project's default locale is not English, its catalogue is the next best fact.
 */
function flattenCatalog(analysis: Analysis, config: ConfigFacts): Record<string, string> {
  const defaultLocale = config.defaultLocale ?? "en";
  const analyzerCatalog =
    analysis.locales["en"] ?? analysis.locales[defaultLocale] ?? ({} as Record<string, string>);
  return { ...analyzerCatalog };
}

/** Build the typed context from analyzer facts; the manifest only contributes fallbacks. */
export function buildProjectContext(input: ProjectContextInput): ProjectContext {
  const sources = normalizeSources(input.sources);
  const manifest = factsFromManifest(input.manifest);
  const analysis = input.analysis;
  const before = input.before ?? analysis;
  const config = analysis.config;
  const analyzerCatalog = flattenCatalog(analysis, config);
  const locales: Record<string, string> = { ...manifest.locales, ...analyzerCatalog };
  const blocks: readonly BlockFacts[] = manifest.blocks;
  const routes: readonly RouteFact[] = analysis.routes;
  const tables: readonly TableFact[] = analysis.tables;
  return {
    files: input.files.map(normalizeProjectPath).filter((path) => path.length > 0),
    analysis,
    before,
    config,
    schema: { parsed: analysis.files.includes(SCHEMA_PATH), tables },
    locales,
    blocks,
    routes,
    packages: input.packages ?? packagesFromSource(sources["package.json"]),
    aliases: input.aliases ?? aliasesFromSource(sources["tsconfig.json"]),
  };
}
