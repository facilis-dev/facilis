// The project-graph panel's readiness gate.
//
// `IdeController.openFolder()` starts the asynchronous `indexFolder()` walk and returns at
// once; createProject/openProject/project-scaffold open the graph tab in the same tick. The
// panel's analysis reads the controller snapshot's flat `files` list, so analyzing on mount
// at cold boot reads an unindexed project: no routes, schema or pages, only the analyzer's
// missing-config diagnostic. This module is the pure predicate the panel waits on.
//
// One-shot by design: the panel analyzes when the gate opens (and on Refresh), not on every
// later `files` change, so an edit or an import does not re-walk the project per keystroke.

import { projectRelativePath } from "./analyze-files";

/**
 * Whether the controller has indexed `root` into the snapshot's flat `files` list: one file
 * under the root is enough, because the walk only publishes the list once it has finished.
 *
 * A genuinely empty project (no files at all) never opens the gate, so the panel keeps its
 * loading state for it instead of drawing an empty graph from a snapshot that is not
 * actually indexed. That is the accepted residual risk: a project without files has nothing
 * to graph anyway.
 */
export function isProjectIndexReady(
  snapshotFiles: readonly string[],
  root: string | null,
): boolean {
  if (root === null) return false;
  return snapshotFiles.some((path) => projectRelativePath(root, path) !== null);
}
