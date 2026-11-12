// The IDE's Italian catalogue. Mirrors `en.ts`; a missing key falls back to the
// English one, so this file can land incrementally (the parity test enforces that
// every key here exists in English, not the other way round).
import type { MessageKey } from "./index";
import { updatesIt } from "./it-updates";
import { dataExplorerIt } from "./it-data-explorer";
import { dataQueryIt } from "./it-data-query";
import { releasePreviewIt } from "./it-release-preview";
import { gitRemoteIt } from "./it-git-remote";
import { sourceControlIt } from "./it-source-control";
import { commitGraphIt } from "./it-commit-graph";
import { projectGraphIt } from "./it-project-graph";
import { chatIt } from "./it-chat";
import { logsIt } from "./it-logs";
import { tourIt } from "./it-tour";
import { runIt } from "./it-run";
import { previewIt } from "./it-preview";

export const it: Partial<Record<MessageKey, string>> = {
  // ── product ──────────────────────────────────────────────────────────────
  "app.name": "facilis.dev",

  // ── shared ───────────────────────────────────────────────────────────────
  "common.cancel": "Annulla",
  "common.close": "Chiudi",
  "common.remove": "Rimuovi",

  // ── activity bar (view labels + tooltips) ────────────────────────────────
  "activity.workspace": "Area di lavoro",
  "activity.search": "Cerca",
  "activity.scm": "Controllo del codice sorgente",
  "activity.debug": "Esegui e debug",
  "activity.chat": "Chat AI",
  "activity.theme": "Tema",

  // ── theme (command palette) ──────────────────────────────────────────────
  "theme.light": "Tema: Chiaro",
  "theme.dark": "Tema: Scuro",
  "theme.system": "Tema: Sistema",
  "theme.option.system": "Segui il sistema",
  "theme.option.light": "Chiaro",
  "theme.option.dark": "Scuro",

  // ── Home: recent projects ────────────────────────────────────────────────
  "recent.blank": "vuoto",
  "recent.justNow": "adesso",
  "recent.minutesAgo": "{n} min fa",
  "recent.hoursAgo": "{n} h fa",
  "recent.daysAgo": "{n} g fa",
  "recent.openInNewTab": "Apri in una nuova scheda",
  "recent.openInNewTabAria": "Apri {name} in una nuova scheda",

  // ── bootstrap ────────────────────────────────────────────────────────────
  "boot.starting": "Avvio del runtime",
  "boot.restoring": "Ripristino del progetto salvato",
  "boot.finalizing": "Finalizzazione del runtime",
  "boot.settingUp":
    "Preparazione del runtime nel browser — le azioni su import e progetti si sbloccano tra un istante.",
  "boot.progress": "{done} / {total} ({pct}%)",
  "boot.failed": "Il runtime non è partito",
  "boot.failedHint":
    "Di solito ricaricare la pagina risolve. Se continua, la console del browser contiene l'errore.",
  "boot.reload": "Ricarica",
  "boot.openingTitle": "Apertura di {name}",
  "boot.openingHint": "Ripristino dei file e avvio del runtime.",

  // ── working tree (file riscritti da git) ────────────────────────────────
  "editor.workdir.unsavedKept":
    "Git ha aggiornato la working tree: {n} file aperti con modifiche non salvate hanno mantenuto il loro buffer. Salvali sui file appena aggiornati solo di proposito.",

  // ── projects ─────────────────────────────────────────────────────────────
  "project.missing": "Il progetto di questa scheda non è più nella lista dei recenti.",
  "project.openElsewhere": "{name} è già aperto in un'altra scheda — chiudilo lì prima.",
  "project.starting": "Studio si sta ancora avviando — attendi un istante e riprova.",
  "project.gone": "I file di questo progetto non sono più su disco.",
  "project.deleted": "Eliminato {name}",
  "project.deleteFailed": "Impossibile eliminare {name}: {error}",
  "delete.action": "Elimina progetto",
  "delete.actionAria": "Elimina {name}",
  "delete.title": "Eliminare {name}?",
  "delete.body":
    "Elimina definitivamente il progetto e tutti i suoi file da questo browser. Non è possibile annullare.",
  "delete.confirmLabel": "Digita il nome del progetto per confermare",
  "delete.confirm": "Elimina progetto",
  "delete.deleting": "Eliminazione…",
  "create.failed": "Impossibile creare il progetto: {error}",
  "create.ready": "{name} creato — esegui {install} poi {dev}",

  // ── Home ─────────────────────────────────────────────────────────────────
  "home.backToWorkspace": "Torna all'area di lavoro",
  "home.dropHint": "Rilascia una cartella per importarla come nuovo progetto",
  "home.newProject": "Nuovo progetto",
  "home.newProjectDesc": "Parti da un template — un'app full-stack o un sito statico.",
  "home.importFolder": "Importa una cartella",
  "home.importFolderDesc": "Apri una cartella locale — o trascinala qui — come nuovo progetto.",
  "home.importRemote": "Importa un repository",
  "home.importRemoteDesc":
    "Scarica un repository GitHub, GitLab o Gitea/Forgejo come nuovo progetto.",
  "home.importLocked": "Disponibile quando il progetto salvato finisce di ripristinarsi.",
  "home.recent": "Progetti recenti",
  "home.recentHint":
    "I file e le dipendenze installate sono salvati in questo browser tra un ricaricamento e l'altro.",
  "home.noProjects": "Nessun progetto. Creane uno qui sopra per iniziare.",
  "home.reset": "Ripristina tutto",
  "reset.title": "Ripristinare tutto?",
  "reset.body":
    "Elimina definitivamente tutti i file salvati e le dipendenze in cache da questo browser, poi ricarica Studio con una sessione pulita. Non è possibile annullare.",
  "reset.confirm": "Ripristina tutto",
  "reset.busy": "Ripristino…",
  "create.title": "Nuovo progetto",
  "create.description": "Scegli un punto di partenza, poi assegna un nome al progetto.",
  "create.template": "Template",
  "create.template.todo": "App full-stack",
  "create.template.todoDescription":
    "Nitro + PGlite + React, con autenticazione, todo, upload di file e job.",
  "create.template.showcase": "Sito vetrina statico",
  "create.template.showcaseDescription": "Vite + React + Tailwind, solo frontend — nessun backend.",
  "create.template.starter": "App full-stack vuota",
  "create.template.starterDescription":
    "Nitro + PGlite + React con solo la login standard — nessuna app demo da cancellare.",
  "create.name": "Nome del progetto",
  "create.namePlaceholder": "my-app",
  "create.directory": "Cartella",
  "create.directoryPlaceholder": "/home/user/projects/my-app",
  "create.runInit": "Installa ed esegui",
  "create.runInitHint": "installa le dipendenze e avvia il dev server dopo la creazione.",
  "create.submit": "Crea",
  "create.creating": "Creazione…",
  "create.waiting": "In attesa del runtime…",

  // ── Import from a git host ───────────────────────────────────────────────
  "import.title": "Importa un repository",
  "import.description":
    "Scarica un repository — GitHub, GitLab o Gitea/Forgejo — come nuovo progetto. Il download avviene nel browser, nessun server coinvolto.",
  "import.repository": "Repository",
  "import.repositoryPlaceholder": "owner/repo, owner/repo@branch, o un URL del repository",
  "import.repositoryHint":
    "Pubblico per impostazione predefinita; un repository privato richiede il token qui sotto. Un server self-hosted deve consentire il CORS sulla sua API.",
  "import.token": "Token di accesso (opzionale)",
  "import.tokenPlaceholder": "ghp_…, glpat-…, …",
  "import.tokenHint":
    "Per i repository privati: un token con accesso in lettura. È usato per questo import e non viene mai salvato.",
  "import.tokenInvalid": "Non sembra un token valido.",
  "import.starting": "Avvio…",
  "import.submit": "Importa",
  "import.progress": "{phase} ({done}/{total})",

  // ── Publish to a git host (D-078) ───────────────────────────────────────
  "push.title": "Pubblica su un host git",
  "push.description":
    "Salva questo progetto in un branch GitHub, GitLab o Gitea/Forgejo come un unico commit tramite l'API dell'host — dalla scheda, senza clone e senza server.",
  "push.repository": "Repository",
  "push.repositoryPlaceholder": "owner/repo, o l'URL del repository",
  "push.repositoryHint":
    "Il repository deve esistere già; un server self-hosted deve consentire il CORS sulla sua API.",
  "push.token": "Token di accesso",
  "push.tokenPlaceholder": "ghp_…, glpat-…, …",
  "push.tokenHint":
    "Serve l'accesso in scrittura (GitHub Contents write, GitLab write_repository, Gitea write:repository). Usato per questa pubblicazione e mai salvato.",
  "push.tokenInvalid": "Non sembra un token valido.",
  "push.branch": "Branch",
  "push.branchPlaceholder": "main",
  "push.branchHint": "Lascia vuoto per usare il branch predefinito del repository.",
  "push.newBranchName": "Nome del nuovo branch",
  "push.createBranch": "Crea un nuovo branch",
  "push.message": "Messaggio di commit",
  "push.author": "Autore del commit",
  "push.authorName": "Nome",
  "push.authorEmail": "Email",
  "push.authorHint": "Salvato in questo browser per le prossime pubblicazioni.",
  "push.check": "Controlla modifiche",
  "push.checking": "Controllo…",
  "push.publish": "Pubblica",
  "push.publishing": "Pubblicazione…",
  "push.summary": "{added} nuovi · {modified} modificati · {deleted} eliminati",
  "push.summaryTarget": "{branch} da {base}",
  "push.clean": "Niente da pubblicare — il branch corrisponde già a questo progetto.",
  "push.progress": "{phase} ({done}/{total})",
  "push.phaseListing": "Lettura del branch remoto…",
  "push.phaseUploading": "Caricamento dei file…",
  "push.phaseCommitting": "Creazione del commit…",
  "push.success": "Pubblicato su {branch}",
  "push.successDescription": "{commits} commit · {repository}",
  "push.openProjectFirst": "Apri prima un progetto.",
  "push.kernelStarting": "Il runtime si sta ancora avviando — riprova tra un momento.",
  "push.disabled": "Questa distribuzione non consente la pubblicazione su un host git.",
  ...gitRemoteIt,
  ...sourceControlIt,
  ...commitGraphIt,
  ...projectGraphIt,
  ...dataExplorerIt,
  ...dataQueryIt,
  ...releasePreviewIt,
  ...updatesIt,

  // ── pannello inferiore, barra di stato ed esecuzione (D-124) ────────────
  ...runIt,

  // ── barra del titolo ─────────────────────────────────────────────────────
  "title.home": "Home",
  "title.newTab": "Nuova scheda",
  "title.openNewTab": "Apri Studio in una nuova scheda",
  "title.toggleSidebar": "Mostra/nascondi barra laterale",
  "title.togglePreview": "Mostra/nascondi anteprima",
  "title.tagline": "un vero dev server, nel tuo browser",

  // ── barra di stato ───────────────────────────────────────────────────────
  "status.branch": "Branch corrente",
  "status.goToLine": "Vai a riga/colonna",
  "status.indent": "Scegli indentazione",
  "status.language": "Scegli linguaggio",
  "status.python": "Servizio linguaggio Python (jedi, black)",
  "status.position": "Riga {line}, Col {column}",
  "status.error": "errore",
  "status.errors": "errori",
  "status.warning": "avviso",
  "status.warnings": "avvisi",
  "status.selections": "({count} selezioni)",
  "status.selected": "({count} selezionati)",
  "status.device.memoryPressure": "Memoria sotto pressione",
  "status.device.lowMemory": "Poca RAM",
  "status.device.slowBoot": "Avvio lento",
  "status.device.lowStorage": "Spazio quasi esaurito",
  "status.device.hint":
    "Questa scheda esegue l'intera VM. Chiudere altre schede e app libera la memoria che le serve.",

  // ── pannello anteprima ───────────────────────────────────────────────────
  ...previewIt,

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
  "palette.importRemote": "Importa un repository",
  "palette.pushRemote": "Pubblica su un host git",
  "palette.openChat": "Apri chat AI",
  "palette.tour": "Mostra il tour dell'IDE",
  "palette.exportZip": "Esporta progetto come Zip",
  "palette.shareProject": "Condividi progetto (copia link)",
  "palette.toggleTerminal": "Mostra/nascondi pannello",
  "palette.toggleSidebar": "Mostra/nascondi barra laterale",
  "palette.togglePreview": "Mostra/nascondi pannello anteprima",
  "palette.toggleWordWrap": "Attiva/disattiva a capo automatico",
  "palette.clearTerminal": "Pulisci terminale attivo",
  "palette.reloadPreview": "Ricarica anteprima",
  "palette.measureMemory": "Misura memoria",
  "palette.resetEverything": "Ripristina tutto (file + cache)",
  "palette.resetConfirm":
    "Ripristinare tutto? Elimina definitivamente tutti i file salvati e le dipendenze in cache, poi ricarica.",

  // ── AI chat (D-045) ──────────────────────────────────────────────────────
  ...chatIt,

  // ── operator logs (D-119) ────────────────────────────────────────────────
  ...logsIt,

  // ── guided tour (D-128) ─────────────────────────────────────────────────
  ...tourIt,
};
