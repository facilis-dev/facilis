// The data lens's Italian catalogue (issue #70), split from it-project-graph.ts for the
// 300-line source limit — the same pattern as the matrix (#67) and contract (#69) catalogues.

import type { MessageKey } from "./index";

export const projectGraphDataIt: Partial<Record<MessageKey, string>> = {
  "projectGraph.data.label": "Lente dati",
  "projectGraph.data.unscoped": "Senza scope",
  "projectGraph.data.definer": "Viste definer",
  "projectGraph.data.elevated": "Elevati",
  "projectGraph.data.unscopedHint":
    "Tabelle senza una colonna di scope tenant/owner, contate sul grafo disegnato.",
  "projectGraph.data.definerHint":
    "Viste con accesso definer: un permesso dichiarato bypassa la RLS dell'invoker.",
  "projectGraph.data.elevatedHint":
    "Archi raggiunti tramite accesso sudo/system auditato, contati sul grafo disegnato.",
  "projectGraph.data.legend": "Legenda dei tratti della lente dati",
  "projectGraph.data.legendEntry": "{stroke} — {pattern}",
  "projectGraph.data.pattern.solid": "continuo",
  "projectGraph.data.pattern.dashed": "tratteggiato",
  "projectGraph.data.pattern.shortDash": "tratto corto",
  "projectGraph.data.pattern.dashDot": "tratto-punto",
  "projectGraph.data.pattern.dottedLock": "punteggiato + lucchetto",
  "projectGraph.data.scope.tenant": "scope tenant",
  "projectGraph.data.scope.owner": "scope owner",
  "projectGraph.data.scope.none": "nessuno scope",
  "projectGraph.data.scope.unknown": "scope sconosciuto",
  "projectGraph.data.policies": "{count} policy",
  "projectGraph.data.policiesUnknown": "policy sconosciute",
  "projectGraph.data.accessUnknown": "accesso sconosciuto",
  "projectGraph.data.permissionUnknown": "permesso sconosciuto",
  "projectGraph.data.elevatedEdge": "Accesso elevato (sudo/system auditato)",
};
