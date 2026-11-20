// The Italian project-update strings (D-065); spread into `it` in it.ts.
import type { MessageKey } from "./index";

export const updatesIt: Partial<Record<MessageKey, string>> = {
  "updates.available": "Aggiornamento disponibile",
  "updates.aheadBadge": "Progetto più recente",
  "updates.tooltip": "Progetto {project} · questo Studio {build}",
  "updates.title": "Aggiornamenti del progetto",
  "updates.description": "Questo progetto è stato creato da una versione precedente dello Studio.",
  "updates.ahead": "Questo progetto è stato creato da uno Studio più recente. Aprilo lì.",
  "updates.projectVersion": "Versione progetto",
  "updates.buildVersion": "Questo Studio",
  "updates.unknown": "sconosciuta",
  "updates.noRecipe":
    "Questo Studio non include ancora una ricetta di aggiornamento per questo salto, quindi non viene applicato nulla automaticamente. Esporta il progetto e ricrealo dal template corrente, oppure usa una build che includa la ricetta.",
  "updates.baseline": "Baseline approvata: {baseline}",
  "updates.frameworkMinimum.title":
    "Aggiorna i pacchetti framework alle versioni minime di questa build",
  "updates.framework.blockedTitle": "I pacchetti framework non sono aggiornati",
  "updates.framework.blockedDescription":
    "Questo progetto fissa pacchetti @facilis.dev/* a versioni inferiori alle minime richieste da questo Studio, quindi non può avviarsi finché non vengono aggiornati.",
  "updates.framework.belowRow": "{name}: {pinned} → minima {minimum}",
  "updates.framework.update": "Aggiorna i pacchetti framework",
  "updates.framework.decline": "Non ora",
  "updates.framework.applying": "Aggiornamento di package.json e reinstallazione delle dipendenze…",
  "updates.framework.declined":
    "Avvio rifiutato: i pin @facilis.dev/* di questo progetto sono sotto le minime della build. Esegui di nuovo per aggiornarli.",
  "updates.framework.failed":
    "L'aggiornamento del framework non è riuscito; il progetto non è stato avviato.",
  "updates.framework.failedRolledBack":
    "L'aggiornamento del framework non è riuscito ed è stato annullato; il progetto non è stato avviato. Riprova.",
  "updates.framework.failedNoRollback":
    "L'aggiornamento del framework non è riuscito e il ripristino è incompleto — controlla i file del progetto prima di riavviarlo.",
  "updates.framework.retry": "Riprova",
  "updates.framework.close": "Chiudi",
};
