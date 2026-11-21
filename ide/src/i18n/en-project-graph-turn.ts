// The agent turn-diff lens's catalogue (issue #73), split from en-project-graph.ts for the
// 300-line source limit — the same pattern as the matrix (#67), contract (#69) and data (#70)
// catalogues. Ribbon counters, base ref, the "not on the graph" disclosure and the per-card
// M/A/D hints; every state is named, never colour alone (epic rule 6), and "no checkpoint" and
// "clean" are distinct visible states (epic rule 5).

export const projectGraphTurnEn = {
  "projectGraph.turnDiff.label": "Turn diff",
  "projectGraph.turnDiff.changed": "changed",
  "projectGraph.turnDiff.added": "added",
  "projectGraph.turnDiff.deleted": "deleted",
  "projectGraph.turnDiff.counter": "{count} {label}",
  "projectGraph.turnDiff.base": "base {ref}",
  "projectGraph.turnDiff.baseHint": "The turn checkpoint: a clean HEAD (D-181)",
  "projectGraph.turnDiff.clean": "Clean tree — nothing changed this turn",
  "projectGraph.turnDiff.noGit": "No git checkpoint — the turn diff is unavailable",
  "projectGraph.turnDiff.unmapped": "{count} not on the graph",
  "projectGraph.turnDiff.unmappedHint": "Changed files with no node in the current view",
  "projectGraph.turnDiff.modified": "Modified this turn",
  "projectGraph.turnDiff.addedNode": "Added this turn",
  "projectGraph.turnDiff.deletedHint": "Deleted this turn — {source}",
  "projectGraph.turnDiff.planned": "Planned — not written yet",
  "projectGraph.turnDiff.plannedHint": "Planned this turn, not written yet — {path}",
} as const;
