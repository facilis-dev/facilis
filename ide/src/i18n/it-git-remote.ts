// The Italian half of the D-079 block (see en-git-remote.ts); spread into `it`.
import type { MessageKey } from "./index";

export const gitRemoteIt: Partial<Record<MessageKey, string>> = {
  "gitRemote.title": "Remote git",
  "gitRemote.description":
    "Fetch, pull e push con git vero, attraverso il proxy stateless di questa distribuzione.",
  "gitRemote.remote": "Remote",
  "gitRemote.remotePlaceholder": "https://github.com/owner/repo.git",
  "gitRemote.save": "Salva remote",
  "gitRemote.saved": "Remote salvato",
  "gitRemote.token": "Token di accesso (opzionale)",
  "gitRemote.tokenPlaceholder": "ghp_…, glpat-…, …",
  "gitRemote.tokenHint":
    "Serve per i repository privati e per il push. Usato per questa operazione e mai salvato.",
  "gitRemote.username": "Username (opzionale)",
  "gitRemote.usernamePlaceholder": "git",
  "gitRemote.usernameHint":
    "Solo per gli host che richiedono un username insieme al token (Gitea/Forgejo).",
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
    "Owner/repo oppure l'URL del repository. Pubblico per impostazione predefinita; un repository privato richiede il token qui sotto.",
};
