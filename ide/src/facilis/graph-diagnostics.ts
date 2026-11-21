// Attaching the analyzer's errors and warnings to graph nodes (issue #69). The join is
// one-to-one: every attachable diagnostic lands on exactly one node, never duplicated across the
// cards that share a source file (a schema file declares many tables). Attribution is by source
// file, disambiguated by declaration line when a file carries several nodes. A diagnostic that
// cannot be attributed — no source, a config/locale/job file with no graph node, or a line above
// every declaration in a shared file — stays unattached: the HUD badge still counts it, but the
// lens never guesses a node (epic rule 5). Info diagnostics are not contract failures and stay
// out of the lens.

import {
  routeId,
  tableId,
  viewId,
  type Analysis,
  type Diagnostic,
  type GraphNode,
} from "@facilis.dev/analyze";

/** Declaration lines per node id: tables, views and routes can share a file, so the line decides. */
function declarationLines(analysis: Analysis): ReadonlyMap<string, number> {
  const lines = new Map<string, number>();
  for (const table of analysis.tables) lines.set(tableId(table.name), table.source.line);
  for (const view of analysis.views) lines.set(viewId(view.name), view.source.line);
  for (const route of analysis.routes) lines.set(routeId(route), route.source.line);
  return lines;
}

/**
 * Pick the node a diagnostic belongs to. A file with a single node attaches outright — the node
 * is the file's only graph representative. In a shared file the declaration starting closest
 * above the diagnostic wins; a line above every declaration is file-level and stays unattached
 * rather than guessed onto the first card.
 */
function attribute(
  candidates: readonly GraphNode[],
  line: number,
  lines: ReadonlyMap<string, number>,
): GraphNode | null {
  if (candidates.length === 1) return candidates[0];
  let best: GraphNode | null = null;
  let bestLine = -1;
  for (const candidate of candidates) {
    const start = lines.get(candidate.id);
    if (start === undefined || start > line || start <= bestLine) continue;
    best = candidate;
    bestLine = start;
  }
  return best;
}

/** Every node id with attached errors/warnings, in analysis order (already severity-sorted). */
export function buildNodeDiagnostics(
  analysis: Analysis,
): ReadonlyMap<string, readonly Diagnostic[]> {
  const byFile = new Map<string, GraphNode[]>();
  for (const node of analysis.graph.nodes) {
    if (node.sourceFile === null) continue;
    const list = byFile.get(node.sourceFile) ?? [];
    list.push(node);
    byFile.set(node.sourceFile, list);
  }
  const lines = declarationLines(analysis);
  const attached = new Map<string, Diagnostic[]>();
  for (const diagnostic of analysis.diagnostics) {
    if (diagnostic.severity === "info") continue;
    const source = diagnostic.source;
    if (source === null) continue;
    const candidates = byFile.get(source.file);
    if (candidates === undefined) continue;
    const node = attribute(candidates, source.line, lines);
    if (node === null) continue;
    const list = attached.get(node.id) ?? [];
    list.push(diagnostic);
    attached.set(node.id, list);
  }
  return attached;
}

/** The worst severity attached to a node: the card ring's role (error beats warning). */
export function worstSeverity(diagnostics: readonly Diagnostic[]): "error" | "warning" | null {
  if (diagnostics.some((entry) => entry.severity === "error")) return "error";
  return diagnostics.length > 0 ? "warning" : null;
}
