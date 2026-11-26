/**
 * D-217 diagnostic: one warning per import cycle (strongly connected component) in the
 * project's static import graph. Cycles hurt boot order and bundling, but a warning is the
 * right weight: the project still runs, and the runtime is unchanged. Framework and
 * `node_modules` overlays are excluded by the pass (they are shipped code the project cannot
 * fix), and a self-import is reported as a one-node cycle because it is still a load-order
 * defect.
 */

import { warning } from "../diagnostics.ts";
import { findImportCycles, type ImportCycle } from "../import-cycles.ts";
import type { ModuleGraph } from "../module-graph.ts";
import type { Diagnostic, FileFacts } from "../types.ts";

export const IMPORT_CYCLE_CODE = "import-cycle";

/**
 * At most this many path entries are listed (the closing repeated file included), then the
 * remaining segments are counted. A long SCC would otherwise become an unreadable one-liner
 * in the IDE's diagnostics panel.
 */
export const MAX_CYCLE_PATH_ENTRIES = 8;

function describePath(cycle: ImportCycle): string {
  const shown = cycle.path.slice(0, MAX_CYCLE_PATH_ENTRIES);
  const hidden = cycle.path.length - shown.length;
  const listed = shown.map((path) => '"' + path + '"').join(" -> ");
  return hidden > 0 ? listed + " -> … (" + hidden + " more)" : listed;
}

/** Diagnostics for every import cycle in the project (warn-only, D-217). */
export function importCycleDiagnostics(
  graph: ModuleGraph,
  fileFacts: readonly FileFacts[],
): Diagnostic[] {
  return findImportCycles(graph, fileFacts).map((cycle) => {
    const subject = cycle.selfImport
      ? "Import cycle (self-import)"
      : "Import cycle among " + cycle.files.length + " files";
    return warning(
      IMPORT_CYCLE_CODE,
      subject +
        ": " +
        describePath(cycle) +
        ". Move the shared code into its own module to break the cycle (warning only: the runtime behavior is unchanged).",
      cycle.source,
    );
  });
}
