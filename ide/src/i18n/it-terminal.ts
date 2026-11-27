// Italian form of en-terminal.ts; a missing key falls back to English.
import type { MessageKey } from "./index";

export const terminalIt: Partial<Record<MessageKey, string>> = {
  "terminal.focusHint": "F6 esce dal terminale; Shift+F6 vi riporta il focus.",
};
