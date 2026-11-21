// The agent turn-diff lens's Italian catalogue (issue #73), split like its English twin for the
// 300-line source limit; partial by design, a missing key falls back to English.

import type { MessageKey } from "./index";

export const projectGraphTurnIt: Partial<Record<MessageKey, string>> = {
  "projectGraph.turnDiff.label": "Diff del turno",
  "projectGraph.turnDiff.changed": "modificati",
  "projectGraph.turnDiff.added": "aggiunti",
  "projectGraph.turnDiff.deleted": "eliminati",
  "projectGraph.turnDiff.counter": "{count} {label}",
  "projectGraph.turnDiff.base": "base {ref}",
  "projectGraph.turnDiff.baseHint": "Il checkpoint del turno: un HEAD pulito (D-181)",
  "projectGraph.turnDiff.clean": "Albero pulito — nessuna modifica in questo turno",
  "projectGraph.turnDiff.noGit": "Nessun checkpoint git — diff del turno non disponibile",
  "projectGraph.turnDiff.unmapped": "{count} fuori dal grafo",
  "projectGraph.turnDiff.unmappedHint": "File modificati senza un nodo nella vista corrente",
  "projectGraph.turnDiff.modified": "Modificato in questo turno",
  "projectGraph.turnDiff.addedNode": "Aggiunto in questo turno",
  "projectGraph.turnDiff.deletedHint": "Eliminato in questo turno — {source}",
  "projectGraph.turnDiff.planned": "Pianificato — non ancora scritto",
  "projectGraph.turnDiff.plannedHint": "Pianificato in questo turno, non ancora scritto — {path}",
};
