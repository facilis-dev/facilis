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
  "shortcuts.help": "Scorciatoie da tastiera",
  "shortcuts.closeTab": "Chiudi scheda dell'editor",
  "shortcuts.cycleTabs": "Passa tra le schede dell'editor",
  "shortcuts.note.browserKeeps": "Scorciatoia riservata al browser: l'IDE non può assegnarla.",

  // La finestra di aiuto.
  "shortcuts.dialogTitle": "Scorciatoie da tastiera",
  "shortcuts.dialogHint":
    "Comandi globali dal registro dell'IDE, nella grafia di questa piattaforma. Premi ? quando nessun campo modificabile ha il focus per aprire questo elenco.",
  "shortcuts.group.global": "Globali",
  "shortcuts.group.editor": "Editor",
  "shortcuts.group.terminal": "Terminale",
  "shortcuts.group.dialog": "Finestre di dialogo",
  "shortcuts.group.overlay": "Sovrapposizioni",
  "shortcuts.group.browser": "Riservate al browser",
  "shortcuts.close": "Chiudi",
  "shortcuts.notInRegistry.title": "Non in questo elenco",
  "shortcuts.notInRegistry.escape":
    "Escape chiude la superficie aperta — una finestra di dialogo, il drawer e la scheda del grafo di progetto, il drawer stretto o il tour — e quella sequenza appartiene alla superficie, non a questo registro.",
  "shortcuts.notInRegistry.editors":
    "L'editor di codice e il terminale mantengono i propri tasti: i comandi di Monaco e i tasti per pulire ed eseguire del terminale agiscono sulla superficie che ha il focus, quindi non sono elencati qui.",
};
