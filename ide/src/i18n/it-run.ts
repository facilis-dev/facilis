// Pannello inferiore, barra di stato e controlli di esecuzione (D-124). Estratto da it.ts
// per restare sotto il limite di 300 righe, con lo stesso schema di it-project-graph.ts.
export const runIt = {
  // ── pannello inferiore + barra di stato (D-124) ─────────────────────────
  // Il pannello è chiuso di default e le sue tre superfici si aprono dalla barra
  // di stato: queste etichette sono l'unica "tab strip" che gli resta.
  "panel.console": "Console",
  "panel.terminal": "Terminale",
  "panel.ports": "Porte",
  "panel.openConsole": "Mostra console",
  "panel.openTerminal": "Mostra terminale",
  "panel.openPorts": "Mostra porte",
  "panel.hide": "Nascondi pannello",
  "panel.newTerminal": "Nuovo terminale",
  "panel.noTerminals": "Nessun terminale. Premi + per crearne uno.",
  "panel.killTerminal": "Chiudi terminale",
  "panel.noPorts": "Nessuna porta in ascolto. Avvia un progetto per far partire un server.",
  "panel.port": "Porta",
  "panel.process": "Processo",
  "panel.address": "Indirizzo",
  "panel.openPreview": "Apri anteprima",

  // ── esecuzione (il controllo Esegui/Stop della barra di stato) ───────────
  "run.start": "Esegui",
  "run.noProject": "Apri prima un progetto.",
  "run.startHint": "Installa le dipendenze e avvia questo progetto",
  "run.stop": "Ferma",
  "run.stopHint": "Ferma il dev server",
  "run.running": "In esecuzione",
  "run.runningHint": "Mostra l'app in esecuzione",
  "run.failed": "Avvio non riuscito",
  "run.failedHint": "Il progetto non si è avviato — apri il terminale per vedere il motivo",
  "run.showTerminal": "Mostra terminale",

  // ── la conferma sul dispositivo prima di install + dev server (run-consent.ts) ──
  "run.confirm.title": "Avviare il dev server su questo dispositivo?",
  "run.confirm.body":
    "Questo dispositivo ha poca memoria per eseguire un progetto nel browser. Il grafo, l'editor e i file funzionano anche senza.",
  "run.confirm.costInstall": "Scarica le dipendenze del progetto da npm.",
  "run.confirm.costMemory": "Il dev server può occupare quasi un gigabyte di memoria in questa scheda.",
  "run.confirm.costTime": "Il primo avvio può richiedere minuti e il browser può chiudere la scheda.",
  "run.confirm.start": "Avvia comunque",
  "run.confirm.notNow": "Non ora",

  // ── la navigazione inferiore della shell stretta (sotto 1024px, issue #195) ──
  "shell.mobile.files": "File",
  "shell.mobile.code": "Codice",
  "shell.mobile.preview": "Anteprima",
} as const;
