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
};
