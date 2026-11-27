// Italian form of en-shortcuts.ts; a missing key falls back to English.
import type { MessageKey } from "./index";

export const shortcutsIt: Partial<Record<MessageKey, string>> = {
  "shortcuts.wordWrap": "Attiva/disattiva a capo automatico",
  "shortcuts.tabSelect": "Seleziona scheda {index}",
  "shortcuts.tabPrevious": "Scheda precedente dell'editor",
  "shortcuts.tabNext": "Scheda successiva dell'editor",
  "shortcuts.explorer": "Mostra Explorer",
  "shortcuts.search": "Mostra Ricerca",
  "shortcuts.sourceControl": "Mostra Controllo del codice sorgente",
  "shortcuts.commandPalette": "Command palette",
  "shortcuts.filePalette": "Apri file rapido",
  "shortcuts.togglePanel": "Attiva/disattiva pannello",
  "shortcuts.togglePreview": "Attiva/disattiva pannello Anteprima",
  "shortcuts.sidebarToggle": "Attiva/disattiva barra laterale",
  "shortcuts.save": "Salva file",
  "shortcuts.newTerminal": "Nuovo terminale",
  "shortcuts.graphLens": "Selettore lente del grafo",
  "shortcuts.closeTab": "Chiudi scheda dell'editor",
  "shortcuts.cycleTabs": "Passa tra le schede dell'editor",
  "shortcuts.note.browserKeeps": "Scorciatoia riservata al browser: l'IDE non può assegnarla.",
};
