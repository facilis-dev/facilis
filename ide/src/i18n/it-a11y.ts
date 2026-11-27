// Italian form of en-a11y.ts; a missing key falls back to English.
import type { MessageKey } from "./index";

export const a11yIt: Partial<Record<MessageKey, string>> = {
  "a11y.tabFocus.on": "Il tasto Tab sposta il focus: attivo",
  "a11y.tabFocus.off": "Il tasto Tab sposta il focus: disattivo",
};
