// Italian form of en-overlays.ts; a missing key falls back to English.
import type { MessageKey } from "./index";

export const overlaysIt: Partial<Record<MessageKey, string>> = {
  "overlays.share.opening": "Apertura del progetto condiviso…",
  "overlays.share.booting": "Avvio del runtime…",
  "overlays.share.unpacking": "Estrazione dei file…",
};
