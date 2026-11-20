// The Release Preview's declared schema, read through @facilis.dev/analyze (D-086, D-094).
//
// The panel diffs what the repository declares at two refs without booting a project. The
// old reader was a tolerant text scanner of `db/schema.ts`; the ref's DSL sources are now
// analyzed by the same parser-injected analyzer the project graph and the AI validator use.
// The caller supplies the analyzer because the browser runs it in a worker: this module
// stays pure apart from the reads it is handed.

import { schemaSnapshotFromAnalysis } from "@facilis.dev/analyze";
import { isAnalysisPath } from "./analyze-files";
import type { ProjectAnalysisResult } from "./project-analysis";
import type { SchemaSnapshot } from "./release-engine";

const CONFIG_FILE = "facilis.config.ts";
const SCHEMA_DIR = "db/";
/** The schema DSL is TypeScript/JavaScript; `db/migrations/meta/*.json` is not schema source. */
const SCHEMA_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
];

/** Runs the analyzer over a project-relative source map (the Studio uses its worker). */
export type SchemaAnalyzer = (files: ReadonlyMap<string, string>) => Promise<ProjectAnalysisResult>;

/**
 * Whether a ref file belongs to the schema pass: the `db/` DSL surface plus the config,
 * which can move the tenant/owner columns the analyzer uses for `scope`.
 */
export function isSchemaSourcePath(file: string): boolean {
  if (file === CONFIG_FILE) return true;
  if (!file.startsWith(SCHEMA_DIR)) return false;
  if (!SCHEMA_EXTENSIONS.some((extension) => file.endsWith(extension))) return false;
  return isAnalysisPath(file);
}

/** Every file the schema pass reads at a ref, in a stable order. */
export function schemaSourcePaths(files: readonly string[]): string[] {
  return files.filter(isSchemaSourcePath).toSorted((left, right) => left.localeCompare(right));
}

/** Load the schema sources at a ref and run the analyzer over them. */
async function analyzeSchemaSources(
  paths: readonly string[],
  readText: (file: string) => Promise<string | null>,
  analyze: SchemaAnalyzer,
): Promise<ProjectAnalysisResult> {
  const sources = new Map<string, string>();
  for (const file of paths) {
    // One read at a time: a fan-out floods the kernel worker's single-threaded fs queue.
    // oxlint-disable-next-line no-await-in-loop
    const text = await readText(file);
    if (text !== null && text.length > 0) sources.set(file, text);
  }
  return analyze(sources);
}

/**
 * The declared schema at a ref in the shape planSchema consumes (issue #47, lens wired in
 * #48): the full snapshot - columns with types, indexes, checks, unique constraints, enums
 * and policy SQL. Null when the analyzer cannot run: diffing a schema whose tables were
 * silently dropped would invent a plan, so an unknown schema fails closed. Unreadable
 * declarations ride along as `unsupported` entries and fail the plan itself closed.
 */
export async function readReleaseSnapshot(
  paths: readonly string[],
  readText: (file: string) => Promise<string | null>,
  analyze: SchemaAnalyzer,
): Promise<SchemaSnapshot | null> {
  const result = await analyzeSchemaSources(paths, readText, analyze);
  return result.ok ? schemaSnapshotFromAnalysis(result.analysis) : null;
}
