// The Italian half of the dialog feedback block (see en-dialogs.ts), spread into `it`.
import type { MessageKey } from "./index";

export const dialogsIt: Partial<Record<MessageKey, string>> = {
  "delete.confirmMismatch": "Digita {name} esattamente per confermare l'eliminazione.",
  "reset.confirmMismatch": "Digita {word} esattamente per confermare il ripristino.",
  "import.kernelStarting":
    "Il runtime si sta ancora avviando — l'importazione si sblocca tra un momento.",
  "github.copyCode": "Copia codice",
  "github.copied": "Codice copiato",
};
