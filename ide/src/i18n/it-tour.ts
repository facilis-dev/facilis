// Italian form of en-tour.ts. It may land incrementally; a missing key falls back to
// English (see it.ts).
import type { MessageKey } from "./index";

export const tourIt: Partial<Record<MessageKey, string>> = {
  "tour.dialogAria": "Tour guidato dell'IDE",
  "tour.stepOf": "Passo {current} di {total}",
  "tour.next": "Avanti",
  "tour.back": "Indietro",
  "tour.skip": "Salta il tour",
  "tour.done": "Ho capito",
  "tour.helpAria": "Apri il tour guidato",

  "tour.step.graph.title": "Il progetto, al centro",
  "tour.step.graph.body":
    "Un progetto Facilis si apre qui: pagine, rotte, tabelle e viste in un unico grafo. Trascina un nodo per sistemarlo, doppio click per aprire il sorgente.",
  "tour.step.activity.title": "La barra delle viste",
  "tour.step.activity.body":
    "Da qui cambi superficie di lavoro: area di lavoro, ricerca, git, esegui e debug, dati, release, log e chat AI. Il grafo resta a un click.",
  "tour.step.explorer.title": "I file, a colpo d'occhio",
  "tour.step.explorer.body":
    "L'Explorer è la mappa classica del progetto: ogni file con il suo stato git e l'icona giusta. Gestisce anche drag-and-drop e rinomina.",
  "tour.step.chat.title": "Il tuo pair AI",
  "tour.step.chat.body":
    "La chat legge il progetto e propone patch: descrivi la modifica, rivedi il diff, applicala. Vede anche l'anteprima in esecuzione.",
  "tour.step.preview.title": "L'app dal vivo",
  "tour.step.preview.body":
    "Il dev server gira in questa scheda: salvi un file e l'anteprima si aggiorna. I pulsanti di layout in alto mostrano o nascondono il pannello.",
  "tour.step.console.title": "Console e terminale",
  "tour.step.console.body":
    "Il pannello in basso: output del dev server, un terminale vero dentro il WebContainer e le porte in ascolto.",
  "tour.step.status.title": "La barra di stato",
  "tour.step.status.body":
    "Branch git, diagnostica e posizione del cursore, sempre visibili. Clicca una voce per agire.",
  "tour.step.finale.title": "Tour finito",
  "tour.step.finale.body":
    "Rivedilo quando vuoi dal pulsante ? in alto a destra o dalla command palette (⌘K). Il resto si impara usandolo.",
};
