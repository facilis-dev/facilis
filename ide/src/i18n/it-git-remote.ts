// The Italian half of the git-network block (see en-git-remote.ts); spread into `it`.
import type { MessageKey } from "./index";

export const gitRemoteIt: Partial<Record<MessageKey, string>> = {
  "gitRemote.title": "Remote git",
  "gitRemote.description":
    "Fetch, pull e push con git vero, attraverso il proxy stateless di questa distribuzione.",
  "gitRemote.remote": "Remote",
  "gitRemote.remotePlaceholder": "https://github.com/owner/repo.git",
  "gitRemote.save": "Salva remote",
  "gitRemote.saved": "Remote salvato",
  "gitRemote.token": "Token di accesso o password (opzionale)",
  "gitRemote.tokenPlaceholder": "ghp_…, glpat-…, …",
  "gitRemote.tokenHint":
    "Serve per i repository privati e per il push. GitHub: accedi qui sopra o incolla un token; GitLab e Gitea/Forgejo accettano anche la password dell'account. Usato per questa operazione e mai salvato.",
  "gitRemote.username": "Username (opzionale)",
  "gitRemote.usernamePlaceholder": "git",
  "gitRemote.usernameHint":
    "Solo con la password dell'account (GitLab, Gitea/Forgejo), o quando l'host lo richiede insieme al token.",
  "gitRemote.branch": "Branch",
  "gitRemote.aheadBehind": "↑{ahead} ↓{behind}",
  "gitRemote.upToDate": "Allineato al remote.",
  "gitRemote.fetch": "Fetch",
  "gitRemote.fetching": "Fetch in corso…",
  "gitRemote.pull": "Pull",
  "gitRemote.pulling": "Pull in corso…",
  "gitRemote.push": "Push",
  "gitRemote.pushing": "Push in corso…",
  "gitRemote.detecting": "Controllo il remote…",
  "gitRemote.pullHint":
    "Il pull fa solo fast-forward: se i branch sono divergenti segnala un conflitto invece di fare merge.",
  "gitRemote.successFetched": "Fetch completato.",
  "gitRemote.successPulled": "Branch remoto aggiornato.",
  "gitRemote.successPushed": "Branch pubblicato.",
  "gitRemote.notRepository":
    "Questo progetto non ha ancora un remote git — aggiungi l'URL qui sotto.",
  "gitRemote.unavailable":
    "Il git vero richiede il proxy stateless della distribuzione, e questa build non ce l'ha (o non è raggiungibile).",
  "gitRemote.openProjectFirst": "Apri prima un progetto.",
  "gitRemote.kernelStarting": "Il runtime sta ancora partendo — riprova tra un istante.",
  "palette.gitRemote": "Remote git…",
  "import.cloneHint": "Clone git reale — conserva tutta la cronologia e la cartella .git.",
  "import.descriptionGit":
    "Scarica un repository — GitHub, GitLab o Gitea/Forgejo — come nuovo progetto con un clone git reale. Il download passa dal proxy stateless di questa installazione, che non conserva e non registra nulla.",
  "import.repositoryHintGit":
    "owner/repo (GitHub per impostazione predefinita) oppure l'URL del repository; per GitLab e Gitea/Forgejo serve l'URL. Un repository privato richiede il token o la password qui sotto.",

  // ── import con git reale: token o password dell'account (D-081) ─────────
  "import.secretInvalid": "Non sembra un token o una password validi.",
  "import.tokenOrPassword": "Token di accesso o password (opzionale)",
  "import.tokenOrPasswordHint":
    "Per un repository privato. GitHub: accedi qui sopra o incolla un token; GitLab e Gitea/Forgejo accettano anche la password dell'account con l'username qui sotto. Usata per questo import e mai salvata.",
  "import.username": "Username (opzionale)",
  "import.usernamePlaceholder": "il tuo username",
  "import.usernameHint":
    "Solo con la password dell'account (GitLab, Gitea/Forgejo) — GitHub richiede un token.",

  // ── accesso con GitHub via device flow (D-082) ───────────────────────────
  "github.signIn": "Accedi con GitHub",
  "github.hint":
    "Usa il device flow di GitHub: il 2FA resta su GitHub e non c'è un token da incollare. Il token resta solo in questa scheda.",
  "github.contacting": "Contatto GitHub…",
  "github.codeHint": "Inserisci questo codice su GitHub:",
  "github.open": "Apri github.com/login/device",
  "github.waiting": "In attesa dell'autorizzazione…",
  "github.cancel": "Annulla",
  "github.signedIn": "Accesso effettuato con GitHub.",
  "github.signOut": "Esci",
  "github.retry": "Riprova",
  "github.denied": "Autorizzazione GitHub negata.",
  "github.expired": "Il codice è scaduto — ricomincia.",
  "github.network": "Impossibile raggiungere GitHub attraverso il proxy di questa installazione.",
  "github.invalid": "Accesso con GitHub non riuscito. Riprova o incolla un token qui sotto.",
  "github.unavailable": "L'accesso con GitHub non è disponibile in questa installazione.",

  // ── token help (shown by the import, publish and remote dialogs) ─────────
  "token.helpSummary": "Come creare un token",
  "token.githubLine": "Impostazioni › Developer settings › Personal access tokens — {scope}",
  "token.gitlabLine": "Preferenze › Access tokens — {scope}",
  "token.giteaLine": "Impostazioni › Applicazioni — genera un token con {scope}",
  "token.scopeGithubRead": "Contents: Read",
  "token.scopeGithubWrite": "Contents: Read and write",
  "token.scopeGitlabRead": "read_repository",
  "token.scopeGitlabWrite": "write_repository",
  "token.scopeGiteaRead": "read:repository",
  "token.scopeGiteaWrite": "write:repository",

  // ── empty repository → scaffold the Facilis project (D-080) ──────────────
  "palette.scaffold": "Crea un progetto Facilis in questa cartella",
  "clone.emptyTitle": "Il repository non contiene ancora un progetto Facilis",
  "clone.emptyDescription":
    "È clonato e aperto; aggiungi qui l'app Facilis, poi fai commit e push.",
  "clone.emptyAction": "Crea il progetto",
  "scaffold.doneTitle": "Progetto Facilis creato",
  "scaffold.doneDescription": "Avvialo, poi fai commit e push da Source Control.",
  "scaffold.alreadyProject": "Questa cartella contiene già un progetto.",
  "scaffold.failed": "Impossibile creare il progetto: {error}",
  "scaffold.status": "creato il progetto Facilis",
  "scaffold.kernelStarting": "Il runtime sta ancora partendo — riprova tra un istante.",
};
