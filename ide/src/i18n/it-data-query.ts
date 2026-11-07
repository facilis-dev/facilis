// Italian form of en-data-query.ts. It may land incrementally; a missing key falls
// back to English (see it.ts).
import type { MessageKey } from "./index";

export const dataQueryIt: Partial<Record<MessageKey, string>> = {
  "dataQuery.tabTitle": "Console SQL",
  "dataQuery.open": "Apri console SQL",
  "dataQuery.title": "Console SQL",
  "dataQuery.editorLabel": "Query SQL",
  "dataQuery.placeholder": "select * from todos limit 50",
  "dataQuery.run": "Esegui",
  "dataQuery.runShortcut": "Esegui (Ctrl/Cmd + Invio)",
  "dataQuery.running": "Esecuzione della query…",
  "dataQuery.noBase": "Il progetto non è in esecuzione",
  "dataQuery.noBaseHint": "Avvia il progetto per interrogare il suo database live.",
  "dataQuery.idle": "Scrivi una query e premi Esegui.",
  "dataQuery.idleHint": "Ctrl/Cmd + Invio la esegue; i risultati compaiono qui.",
  "dataQuery.retry": "Riprova",
  "dataQuery.error": "La query non è riuscita: {error}",
  "dataQuery.httpStatus": "HTTP {status}",
  "dataQuery.network": "Errore di rete",
  "dataQuery.code.invalid_body": "La richiesta della query non è valida.",
  "dataQuery.code.invalid_sql": "Questa query SQL non può essere eseguita.",
  "dataQuery.code.query_failed": "La query è fallita durante l'esecuzione.",
  "dataQuery.code.unknown": "La query non è stata eseguita.",
  "dataQuery.rowCount": "{count} righe",
  "dataQuery.elapsed": "{ms} ms",
  "dataQuery.truncated": "Risultati troncati dal limite di righe",
  "dataQuery.null": "NULL",
  "dataQuery.noRows": "Nessuna riga.",
  "dataQuery.rlsWarning":
    "Questa console esegue come sviluppatore, quindi qui le RLS non vengono applicate. Le viste create seguono le RLS delle tabelle di base, oppure il permesso scelto per esse.",
  "dataQuery.createView": "Crea vista",
  "dataQuery.createPath": "db/views/{slug}.ts",
  "dataQuery.create.title": "Crea una vista da questa query",
  "dataQuery.create.description":
    "La vista viene creata nel database in esecuzione e la sua definizione viene scritta in {path}.",
  "dataQuery.create.nameLabel": "Nome della vista",
  "dataQuery.create.namePlaceholder": "active_todos",
  "dataQuery.create.nameHint": "Lettere minuscole, cifre e underscore; inizia con una lettera.",
  "dataQuery.create.nameInvalid": "Usa un nome minuscolo (a-z, 0-9, _) che inizi con una lettera.",
  "dataQuery.create.columnsInvalid":
    "Il risultato ha colonne che non possono essere usate in una vista.",
  "dataQuery.create.permissionLabel": "Permesso della vista",
  "dataQuery.create.permissionNone": "Nessuno — permessi (RLS) delle tabelle di base",
  "dataQuery.create.permissionHint":
    "Una vista con permesso è protetta da quel permesso invece che dalle RLS delle tabelle di base.",
  "dataQuery.create.permissionNote":
    "Questa vista esegue con il permesso {permission} come vista definer: le RLS delle tabelle sottostanti NON vengono applicate.",
  "dataQuery.create.rlsNote": "La vista esegue con i permessi (RLS) delle tabelle che seleziona.",
  "dataQuery.create.submit": "Crea vista",
  "dataQuery.create.creating": "Creazione…",
  "dataQuery.create.error.invalidName": "Il nome della vista non è valido.",
  "dataQuery.create.error.invalidSql": "Questa query non può diventare una vista.",
  "dataQuery.create.error.failed": "Impossibile creare la vista.",
  "dataQuery.create.error.invalidPermission":
    "Quel permesso non è dichiarato in facilis.config.ts.",
  "dataQuery.create.error.generic": "Impossibile creare la vista: {error}",
  "dataQuery.writeFailed":
    "La vista è stata creata, ma la scrittura di {path} non è riuscita: {error}",
  "dataQuery.viewCreated": "Vista {name} creata — {path}",
};
