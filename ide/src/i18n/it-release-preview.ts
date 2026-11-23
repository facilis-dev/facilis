// The Italian half of the Release Preview block (see en-release-preview.ts); spread into `it`.
import type { MessageKey } from "./index";

export const releasePreviewIt: Partial<Record<MessageKey, string>> = {
  "activity.release": "Anteprima di rilascio",

  "releasePreview.title": "Anteprima di rilascio",
  "releasePreview.refresh": "Aggiorna l'anteprima di rilascio",
  "releasePreview.loading": "Lettura degli snapshot di rilascio…",
  "releasePreview.retry": "Riprova",
  "releasePreview.noProject": "Apri prima un progetto.",
  "releasePreview.worktree": "copia di lavoro",
  "releasePreview.compare": "{from} → {to}",
  "releasePreview.empty": "Nessuna modifica tra {from} e {to}.",

  "releasePreview.lens.working": "Copia di lavoro",
  "releasePreview.lens.remote": "Remoto",
  "releasePreview.lens.tag": "Tag di rilascio",
  "releasePreview.lens.working.hint": "Copia di lavoro ↔ HEAD — cosa sto per committare?",
  "releasePreview.lens.remote.hint": "HEAD ↔ origin — cosa parte al prossimo deploy?",
  "releasePreview.lens.tag.hint": "Tag ↔ origin — cosa è cambiato dall'ultimo rilascio?",

  "releasePreview.unavailable.no-head":
    "Questo progetto non ha ancora una cronologia git — fai prima un commit.",
  "releasePreview.unavailable.remote-missing":
    "Nessun branch su origin con cui confrontare. Fai prima fetch o push del remoto.",
  "releasePreview.unavailable.tag-missing":
    "Nessun tag di rilascio — crea un tag su un commit per confrontarlo.",
  "releasePreview.problem.no-project": "Apri prima un progetto.",
  "releasePreview.problem.ref-missing": "Il ref {ref} non esiste in questo repository.",
  "releasePreview.problem.snapshot-missing":
    "Impossibile leggere o analizzare l'albero del progetto su {ref}.",
  "releasePreview.problem.engine":
    "Il motore di rilascio non ha potuto confrontare i due snapshot.",

  "releasePreview.summary.title": "Riepilogo dei rischi",
  "releasePreview.summary.risk": "Rischio complessivo",
  "releasePreview.summary.schema":
    "tabelle +{addedTables}/-{droppedTables} · colonne +{addedColumns}/-{droppedColumns} · policy +{addedPolicies}/-{droppedPolicies}",
  "releasePreview.risk.safe": "Sicuro",
  "releasePreview.risk.careful": "Attenzione",
  "releasePreview.risk.destructive": "Distruttivo",
  "releasePreview.risk.breaking": "Rompente",

  "releasePreview.plan.title": "Piano dello schema",
  "releasePreview.plan.empty": "Nessuna modifica allo schema tra i due ref.",
  "releasePreview.plan.failedClosed":
    "Il piano fallisce chiuso — nessun SQL viene rilasciato finché questi problemi non sono risolti.",
  "releasePreview.plan.requires": "richiede {requirements}",
  "releasePreview.plan.destructive": "Batch distruttivi: {ids}",
  "releasePreview.planProblem.unsupported_declaration": "Dichiarazione non supportata: {construct}",
  "releasePreview.planProblem.unsupported_change": "Modifica non supportata: {construct}",
  "releasePreview.planProblem.policy_unsafe": "Modifica policy non sicura: {construct}",

  "releasePreview.api.title": "Differenze API",
  "releasePreview.api.added": "Route aggiunte",
  "releasePreview.api.removed": "Route rimosse",
  "releasePreview.api.changed": "Route cambiate",
  "releasePreview.api.empty": "Nessuna modifica API.",
  "releasePreview.api.fields": "cambiati: {fields}",

  "releasePreview.security.title": "Differenze di sicurezza",
  "releasePreview.security.policiesAdded": "Policy aggiunte",
  "releasePreview.security.policiesDropped": "Policy rimosse",
  "releasePreview.security.policiesChanged": "Policy modificate",
  "releasePreview.security.rlsDisabled": "RLS spento su tabelle scoped",
  "releasePreview.security.empty": "Nessuna modifica a policy o RLS.",
  "releasePreview.security.direction.broadened": "ampliata",
  "releasePreview.security.direction.narrowed": "ristretta",
  "releasePreview.security.direction.unknown": "modificata",

  "releasePreview.breaking.title": "Modifiche rompenti",
  "releasePreview.breaking.empty": "Nessuna modifica rompente rilevata.",
  "releasePreview.breaking.routes": "usata da {routes}",
  "releasePreview.breaking.dropped_table_in_use":
    "La tabella {table} viene rimossa mentre {count} route la usano ancora",
  "releasePreview.breaking.dropped_column_in_use":
    "La colonna {table}.{column} viene rimossa mentre {count} route la leggono ancora",
  "releasePreview.breaking.widened_type_mismatch":
    "La colonna {table}.{column} cambia tipo in un modo che i client potrebbero non prevedere",

  "releasePreview.warnings.title": "Avvisi",
  "releasePreview.warnings.empty": "Nessun avviso.",
  "releasePreview.warning.destructive_without_backfill":
    "Il batch distruttivo {batch} viene rilasciato senza uno step di backfill",
  "releasePreview.warning.policy_broadened": "La policy {policy} è più ampia di prima",

  "releasePreview.codeLive.title": "Codice ↔ DB live",
  "releasePreview.codeLive.loading": "Confronto di db/schema.ts con il database live…",
  "releasePreview.codeLive.synced": "Codice e database live sono allineati.",
  "releasePreview.codeLive.drift": "{count} differenza/e tra codice e database live.",
  "releasePreview.codeLive.unreachable":
    "Database live non raggiungibile — avvia il progetto per confrontare.",
  "releasePreview.codeLive.open": "Apri db/schema.ts",

  "releasePreview.open": "Apri {path}",

  // ── prerender surface (D-202, issue #84) ───────────────────────────────────
  "releasePreview.prerender.title": "Superficie di prerender",
  "releasePreview.prerender.hint":
    "Modalità di rendering per pagina: le pagine dichiarate e idonee vengono prerenderizzate in build; le altre restano lato client.",
  "releasePreview.prerender.empty": "Nessuna pagina su nessuno dei due lati.",
  "releasePreview.prerender.unavailable":
    "Impossibile leggere i fact di prerender per questo confronto.",
  "releasePreview.prerender.mode.prerender": "prerender",
  "releasePreview.prerender.mode.client": "client",
  "releasePreview.prerender.absent": "assente",
  "releasePreview.prerender.blocked": "dichiarata, non idonea",
  "releasePreview.prerender.added": "{count} aggiunte",
  "releasePreview.prerender.removed": "{count} rimosse",
  "releasePreview.prerender.changed": "{count} modificate",
};
