// The contract lens's catalogue (issue #69), split from en-project-graph.ts for the 300-line
// source limit — the same pattern as the matrix catalogue (#67). Audit-ribbon counters and the
// contract badges; every badge label pairs with a glyph, never colour alone (epic rule 6).

export const projectGraphContractEn = {
  "projectGraph.audit.label": "Contract audit",
  "projectGraph.audit.protected": "Protected",
  "projectGraph.audit.missingInput": "No input",
  "projectGraph.audit.unknown": "Unknown",
  "projectGraph.audit.diagnostics": "Diagnostics",
  "projectGraph.audit.filterHint": "Toggle the {label} filter",
  "projectGraph.audit.protectedHint":
    "Protected routes: a valid wrapper and a required permission. Click to filter.",
  "projectGraph.audit.missingInputHint": "Routes without any input schema. Click to filter.",
  "projectGraph.audit.unknownHint": "Nodes whose facts could not be read. Click to filter.",
  "projectGraph.audit.diagnosticsHint":
    "Analyzer errors and warnings attached to nodes. Click to filter.",
  "projectGraph.contract.input": "input",
  "projectGraph.contract.noInput": "no input",
  "projectGraph.contract.inputUnknown": "input unknown",
  "projectGraph.contract.tables": "{count} tables",
  "projectGraph.contract.tablesUnknown": "tables unknown",
  "projectGraph.contract.rls": "RLS",
  "projectGraph.contract.rlsUnknown": "RLS unknown",
  "projectGraph.contract.policies": "{count} policies",
  "projectGraph.contract.policiesUnknown": "policies unknown",
  "projectGraph.contract.accessUnknown": "access unknown",
  "projectGraph.contract.permissionUnknown": "permission unknown",
  "projectGraph.contract.elevations": "{count} elevations",
  "projectGraph.contract.elevationsHint": "Elevations: {names}",
  "projectGraph.contract.nodeDiagnostics": "{count} diagnostics",
} as const;
