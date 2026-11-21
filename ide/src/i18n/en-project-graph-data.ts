// The data lens's catalogue (issue #70), split from en-project-graph.ts for the 300-line source
// limit — the same pattern as the matrix (#67) and contract (#69) catalogues. Ribbon counters,
// the stroke legend and the schema badges; every state pairs with a glyph, never colour alone
// (epic rule 6), and "unknown" is a label of its own (epic rule 5).

export const projectGraphDataEn = {
  "projectGraph.data.label": "Data lens",
  "projectGraph.data.unscoped": "No scope",
  "projectGraph.data.definer": "Definer views",
  "projectGraph.data.elevated": "Elevated",
  "projectGraph.data.unscopedHint":
    "Tables with no tenant/owner scope column, counted over the drawn graph.",
  "projectGraph.data.definerHint":
    "Views with definer access: a declared permission bypasses the invoker's RLS.",
  "projectGraph.data.elevatedHint":
    "Edges reached through audited sudo/system access, counted over the drawn graph.",
  "projectGraph.data.legend": "Data lens stroke legend",
  "projectGraph.data.legendEntry": "{stroke} — {pattern}",
  "projectGraph.data.pattern.solid": "solid",
  "projectGraph.data.pattern.dashed": "dashed",
  "projectGraph.data.pattern.shortDash": "short dash",
  "projectGraph.data.pattern.dashDot": "dash-dot",
  "projectGraph.data.pattern.dottedLock": "dotted + lock",
  "projectGraph.data.scope.tenant": "tenant scope",
  "projectGraph.data.scope.owner": "owner scope",
  "projectGraph.data.scope.none": "no scope",
  "projectGraph.data.scope.unknown": "scope unknown",
  "projectGraph.data.policies": "{count} policies",
  "projectGraph.data.policiesUnknown": "policies unknown",
  "projectGraph.data.accessUnknown": "access unknown",
  "projectGraph.data.permissionUnknown": "permission unknown",
  "projectGraph.data.elevatedEdge": "Elevated access (audited sudo/system)",
} as const;
