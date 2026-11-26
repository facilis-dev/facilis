// Le domande di review del grafo (epic #182, issue #190): un codice Q da solo non dice
// nulla a una persona, quindi ogni badge risolve qui la domanda completa. Separato dal
// catalogo principale, che è al limite di 300 righe. Le chiavi restano piatte.
export const projectGraphQuestionsIt = {
  // ── le domande dietro i codici Q (issue #190) ───────────────────────────────
  "projectGraph.surface.question.hint":
    "Passa il mouse su un codice Q per leggere la domanda a cui risponde.",
  "projectGraph.surface.question.q1": "Q1 — Quali route chiama questa pagina?",
  "projectGraph.surface.question.q2": "Q2 — Quali pagine chiamano questa route?",
  "projectGraph.surface.question.q3":
    "Q3 — Quali tabelle e viste raggiunge questa pagina attraverso le sue route (due hop)?",
  "projectGraph.surface.question.q4":
    "Q4 — Quali route toccano i dati con elevazione sudo/system auditata?",
  "projectGraph.surface.question.q5":
    "Q5 — Quale classe RLS, grant e policy ha questa tabella?",
  "projectGraph.surface.question.q6":
    "Q6 — Quale wrapper e permesso proteggono questa route, e quali schemi di input accetta?",
  "projectGraph.surface.question.q7":
    "Q7 — Dove viene usata questa tabella: lettori, scrittori, chiavi esterne e viste?",
  "projectGraph.surface.question.q8":
    "Q8 — Quali riferimenti esterni e viste toccano il dominio di questo nodo?",
  "projectGraph.surface.question.q9":
    "Q9 — Quali nodi sono referenziati da più di un altro dominio?",
  "projectGraph.surface.question.q10":
    "Q10 — Cosa si rompe nel progetto se questo nodo viene eliminato?",
  "projectGraph.surface.question.q16": "Q16 — Dove si trova il file sorgente di questo nodo?",
  "projectGraph.surface.question.q17":
    "Q17 — Quali fatti l'analizzatore non è riuscito a leggere staticamente?",
};
