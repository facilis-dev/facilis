/**
 * Locale catalogs: every `locales/*.json` in the file map (docs/findings/ast-dsl-contract.md
 * §3.5). A missing `locales/` directory is fine (catalogs are optional); malformed JSON is a
 * warning and the catalog is skipped, because i18n completeness is a gate concern but a broken
 * file must never stop the rest of the analysis.
 */

import { warning } from "../diagnostics.ts";
import { DEFAULT_LOCALE, localeParityGaps } from "../locale-parity.ts";
import type { ModuleGraph } from "../module-graph.ts";
import type { Diagnostic, LocaleCatalogs } from "../types.ts";
import { isRecord, projectPath, relativePath, sortDiagnostics } from "./static-read.ts";

const LOCALES_DIR = "locales/";
const JSON_EXTENSION = ".json";

/** Stable analyzer code for a key missing on one side of the parity contract (D-218). */
export const I18N_LOCALE_PARITY_CODE = "i18n-locale-parity";

const DEFAULT_CATALOGUE = LOCALES_DIR + DEFAULT_LOCALE + JSON_EXTENSION;

function parityDiagnostics(
  graph: ModuleGraph,
  locales: Record<string, Readonly<Record<string, string>>>,
): Diagnostic[] {
  return localeParityGaps(locales).map((gap) => {
    const secondary = LOCALES_DIR + gap.locale + JSON_EXTENSION;
    const missingFrom = gap.direction === "missing-from-secondary" ? secondary : DEFAULT_CATALOGUE;
    const presentIn = gap.direction === "missing-from-secondary" ? DEFAULT_CATALOGUE : secondary;
    return warning(
      I18N_LOCALE_PARITY_CODE,
      'locale key "' + gap.key + '" is in ' + presentIn + " but missing from " + missingFrom + ".",
      { file: projectPath(graph.root, missingFrom), line: 1 },
    );
  });
}

export interface LocaleResult {
  readonly locales: LocaleCatalogs;
  readonly diagnostics: readonly Diagnostic[];
}

function parseCatalog(source: string): Record<string, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const catalog: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") catalog[key] = value;
  }
  return catalog;
}

/** Read the locale JSON files from the project file map. */
export function readLocaleCatalogs(graph: ModuleGraph): LocaleResult {
  const files = [...graph.allFiles.entries()]
    .filter(([path]) => {
      const relative = relativePath(graph.root, path);
      if (!relative.startsWith(LOCALES_DIR)) return false;
      const name = relative.slice(LOCALES_DIR.length);
      return (
        !name.includes("/") && name.endsWith(JSON_EXTENSION) && name.length > JSON_EXTENSION.length
      );
    })
    .toSorted(([left], [right]) => left.localeCompare(right));
  const locales: Record<string, Readonly<Record<string, string>>> = {};
  const diagnostics: Diagnostic[] = [];
  for (const [path, source] of files) {
    const relative = relativePath(graph.root, path);
    const name = relative.slice(LOCALES_DIR.length, -JSON_EXTENSION.length);
    const catalog = parseCatalog(source);
    if (catalog === null) {
      diagnostics.push(
        warning("i18n-catalog", "locale catalog " + relative + " is not a JSON object", {
          file: path,
          line: 1,
        }),
      );
      continue;
    }
    locales[name] = catalog;
  }
  diagnostics.push(...parityDiagnostics(graph, locales));
  return { locales, diagnostics: sortDiagnostics(diagnostics) };
}
