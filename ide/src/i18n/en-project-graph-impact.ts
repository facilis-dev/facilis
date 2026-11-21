// The impact simulation lens's catalogue (issue #74), split from en-project-graph.ts for the
// 300-line source limit — the same pattern as the matrix (#67), contract (#69), data (#70) and
// agent (#73) catalogues. The HUD line, the satellite section and the card badges; "not
// analysed" and "never read" are named states, never guessed facts (epic rules 5 and 6).

export const projectGraphImpactEn = {
  "projectGraph.impact.label": "Impact simulation",
  "projectGraph.impact.section": "Impact simulation",
  "projectGraph.impact.simulate": "Simulate removal",
  "projectGraph.impact.simulateHint":
    "Preview what breaks if this table or view is removed — the model is never changed (Esc to exit)",
  "projectGraph.impact.stop": "Stop simulation",
  "projectGraph.impact.exit": "Exit impact simulation",
  "projectGraph.impact.exitHint": "Restore the previous view (Esc)",
  "projectGraph.impact.counts": "{routes} routes, {views} views",
  "projectGraph.impact.hint": "Select a table to simulate its removal",
  "projectGraph.impact.simulating": "simulating removal",
  "projectGraph.impact.simulatingHint":
    "Simulated as removed: dependents keep their colour, the rest dims — nothing is changed",
  "projectGraph.impact.neverRead": "never read",
  "projectGraph.impact.neverReadHint": "No route reads this table, directly or through a view",
  "projectGraph.impact.routes": "Affected routes",
  "projectGraph.impact.methodRoutes": "{method} routes",
  "projectGraph.impact.noDependents": "No route depends on this selection.",
  "projectGraph.impact.columns": "Column-level impact",
  "projectGraph.impact.columnNotAnalysed": "column-level impact is not analysed",
  "projectGraph.impact.columnNoDependents": "No route declares this column.",
  "projectGraph.impact.simulateColumn": "Simulate removing column {column}",
  "projectGraph.impact.stopColumn": "Stop simulating column {column}",
} as const;
