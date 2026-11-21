// The contract lens's Italian catalogue (issue #69), split from it-project-graph.ts for the
// 300-line source limit — the same pattern as the matrix catalogue (#67).

import type { MessageKey } from "./index";

export const projectGraphContractIt: Partial<Record<MessageKey, string>> = {
  "projectGraph.audit.label": "Audit del contratto",
  "projectGraph.audit.protected": "Protette",
  "projectGraph.audit.missingInput": "Senza input",
  "projectGraph.audit.unknown": "Sconosciuti",
  "projectGraph.audit.diagnostics": "Diagnostica",
  "projectGraph.audit.filterHint": "Attiva/disattiva il filtro {label}",
  "projectGraph.audit.protectedHint":
    "Route protette: wrapper valido e permesso richiesto. Clicca per filtrare.",
  "projectGraph.audit.missingInputHint": "Route senza alcuno schema di input. Clicca per filtrare.",
  "projectGraph.audit.unknownHint": "Nodi i cui fatti non sono stati letti. Clicca per filtrare.",
  "projectGraph.audit.diagnosticsHint":
    "Errori e avvisi dell'analizzatore associati ai nodi. Clicca per filtrare.",
  "projectGraph.contract.input": "input",
  "projectGraph.contract.noInput": "senza input",
  "projectGraph.contract.inputUnknown": "input sconosciuto",
  "projectGraph.contract.tables": "{count} tabelle",
  "projectGraph.contract.tablesUnknown": "tabelle sconosciute",
  "projectGraph.contract.rls": "RLS",
  "projectGraph.contract.rlsUnknown": "RLS sconosciuto",
  "projectGraph.contract.policies": "{count} policy",
  "projectGraph.contract.policiesUnknown": "policy sconosciute",
  "projectGraph.contract.accessUnknown": "accesso sconosciuto",
  "projectGraph.contract.permissionUnknown": "permesso sconosciuto",
  "projectGraph.contract.elevations": "{count} elevazioni",
  "projectGraph.contract.elevationsHint": "Elevazioni: {names}",
  "projectGraph.contract.nodeDiagnostics": "{count} diagnostiche",
};
