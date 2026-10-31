// The IDE's Italian catalogue. Mirrors `en.ts`; a missing key falls back to the
// English one, so this file can land incrementally (the parity test enforces that
// every key here exists in English, not the other way round).
import type { MessageKey } from "./index";

export const it: Partial<Record<MessageKey, string>> = {
  // ── shared ───────────────────────────────────────────────────────────────
  "common.cancel": "Annulla",
  "common.close": "Chiudi",
  "common.remove": "Rimuovi",

  // ── theme (command palette) ──────────────────────────────────────────────
  "theme.light": "Tema: Chiaro",
  "theme.dark": "Tema: Scuro",
  "theme.system": "Tema: Sistema",

  // ── Home: recent projects ────────────────────────────────────────────────
  "recent.blank": "vuoto",
  "recent.justNow": "adesso",
  "recent.minutesAgo": "{n} min fa",
  "recent.hoursAgo": "{n} h fa",
  "recent.daysAgo": "{n} g fa",
  "recent.openInNewTab": "Apri in una nuova scheda",
  "recent.openInNewTabAria": "Apri {name} in una nuova scheda",
  "recent.removeFromList": "Rimuovi dalla lista",

  // ── Import from GitHub / npm ─────────────────────────────────────────────
  "import.title": "Importa da GitHub o npm",
  "import.description":
    "Scarica un repo pubblico o un pacchetto npm come nuovo progetto. Il download avviene nel browser — nessun server coinvolto.",
  "import.github": "GitHub",
  "import.npm": "npm",
  "import.repository": "Repository",
  "import.package": "Pacchetto",
  "import.githubPlaceholder": "owner/repo, owner/repo@branch, o un URL github.com",
  "import.npmPlaceholder": "left-pad, react@18, o @scope/pkg@1.2.3",
  "import.githubHint": "Solo repository pubblici. Branch predefinito se non indichi un ref.",
  "import.npmHint":
    "Estrae il tarball pubblicato (il contenuto del pacchetto, non le sue dipendenze).",
  "import.starting": "Avvio…",
  "import.submit": "Importa",
  "import.progress": "{phase} ({done}/{total})",

  // ── command palette ──────────────────────────────────────────────────────
  "palette.commandPlaceholder": "Digita un comando…",
  "palette.filePlaceholder": "Cerca file per nome (aggiungi :riga per saltarci)…",
  "palette.commands": "Comandi",
  "palette.noResults": "Nessun risultato.",
  "palette.currentFile": "File corrente",
  "palette.files": "File",
  "palette.filesLine": "File · riga {line}",
  "palette.goToLine": "Vai alla riga {line}",
  "palette.home": "Home / Nuovo progetto",
  "palette.newTerminal": "Nuovo terminale",
  "palette.runProject": "Esegui progetto",
  "palette.importFolder": "Importa cartella come progetto",
  "palette.importRemote": "Importa da GitHub o npm",
  "palette.exportZip": "Esporta progetto come Zip",
  "palette.shareProject": "Condividi progetto (copia link)",
  "palette.toggleTerminal": "Mostra/nascondi pannello terminale",
  "palette.toggleSidebar": "Mostra/nascondi barra laterale",
  "palette.togglePreview": "Mostra/nascondi pannello anteprima",
  "palette.toggleWordWrap": "Attiva/disattiva a capo automatico",
  "palette.clearTerminal": "Pulisci terminale attivo",
  "palette.reloadPreview": "Ricarica anteprima",
  "palette.measureMemory": "Misura memoria",
  "palette.resetEverything": "Ripristina tutto (file + cache)",
  "palette.resetConfirm":
    "Ripristinare tutto? Elimina definitivamente tutti i file salvati e le dipendenze in cache, poi ricarica.",
};
