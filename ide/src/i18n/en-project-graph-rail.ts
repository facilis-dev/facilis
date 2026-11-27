// The project-graph node rail strings (issue #213), split from en-project-graph.ts because that
// feature catalogue sits at the 300-line source limit. Spread into `en` in en.ts; keys stay flat.
export const projectGraphRailEn = {
  "projectGraph.nodeList.title": "Nodes",
  "projectGraph.nodeList.show": "Show node list",
  "projectGraph.nodeList.hide": "Hide node list",
  "projectGraph.nodeList.empty": "No nodes in this view.",
  "projectGraph.nodeList.selected": "Selected node: {label} ({kind})",
} as const;
