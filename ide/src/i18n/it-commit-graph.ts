// Italian form of en-commit-graph.ts. It may land incrementally; a missing key falls
// back to English (see it.ts).
import type { MessageKey } from "./index";

export const commitGraphIt: Partial<Record<MessageKey, string>> = {
  "commitGraph.tabTitle": "Grafo dei commit",
  "commitGraph.open": "Apri grafo dei commit",
  "commitGraph.title": "Grafo dei commit",
  "commitGraph.refresh": "Aggiorna il grafo",
  "commitGraph.focus": "Focus: nascondi i pannelli laterali",
  "commitGraph.unfocus": "Ripristina i pannelli laterali",
  "commitGraph.loading": "Lettura del grafo dei commit…",
  "commitGraph.error": "Impossibile leggere il grafo dei commit: {error}",
  "commitGraph.notRepo": "Questa cartella non è un repository git.",
  "commitGraph.empty": "Nessun commit.",
  "commitGraph.emptyHint": "Il grafo si popola appena il repository ha un commit.",
  "commitGraph.stats": "{commits} commit · {branches} branch · {lanes} corsie",
  "commitGraph.legend": "Legenda",
  "commitGraph.legendCommit": "commit",
  "commitGraph.legendBranch": "punta di branch",
  "commitGraph.legendHead": "HEAD (branch corrente)",
  "commitGraph.head": "HEAD",
  "commitGraph.hint":
    "Clicca un commit per i dettagli; trascina per spostarti, scorri per lo zoom.",
  "commitGraph.details": "Dettagli del commit",
  "commitGraph.detailsClose": "Chiudi dettagli",
  "commitGraph.detailsAuthor": "Autore",
  "commitGraph.detailsDate": "Data",
  "commitGraph.detailsOid": "Commit",
  "commitGraph.detailsBranches": "Branch",
  "commitGraph.detailsNone": "Nessun branch punta a questo commit.",
  "commitGraph.openBranch": "Passa a {branch}",
};
