// Italian form of en-preview.ts. It may land incrementally; a missing key falls back to
// the English one (see it.ts).
import type { MessageKey } from "./index";

export const previewIt: Partial<Record<MessageKey, string>> = {
  "preview.empty": "Nessuna anteprima aperta.",
  "preview.emptyTab": "Scheda vuota — digita un indirizzo locale come localhost:3000 e premi Invio.",
  "preview.runProject": "Esegui progetto",
  "preview.startFailed": "Il progetto non si è avviato.",
  "preview.progressHint":
    "L'anteprima compare appena il dev server si mette in ascolto. Il dettaglio è nel terminale.",
  "preview.retry": "Riprova",
  "preview.newTab": "Nuova scheda browser",
  "preview.tabTitle": "Anteprima ({port})",
  "preview.untitledTab": "Nuova scheda",
  "preview.close": "Chiudi",
  "preview.closeOthers": "Chiudi le altre",
  "preview.closeRight": "Chiudi a destra",
  "preview.closeAll": "Chiudi tutte",
  "preview.back": "Indietro",
  "preview.forward": "Avanti",
  "preview.reload": "Ricarica",
  "preview.openDevtools": "Apri DevTools",
  "preview.closeDevtools": "Chiudi DevTools",
  "preview.openExternal": "Apri in una nuova scheda",
  "preview.address": "Indirizzo locale",
  "preview.devtoolsTitle": "DevTools",
};
