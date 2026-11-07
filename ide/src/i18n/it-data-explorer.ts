// The Italian half of the Data Explorer block (see en-data-explorer.ts); spread into `it`.
import type { MessageKey } from "./index";

export const dataExplorerIt: Partial<Record<MessageKey, string>> = {
  "activity.data": "Dati",

  "dataExplorer.title": "Esploratore dati",
  "dataExplorer.refresh": "Aggiorna schema",
  "dataExplorer.retry": "Riprova",
  "dataExplorer.unreachable": "Progetto non raggiungibile",
  "dataExplorer.unreachableHint": "Avvia il progetto per introspezionare il database live.",
  "dataExplorer.loading": "Lettura dello schema live…",
  "dataExplorer.dbUnavailable":
    "Il database non è disponibile. Controlla gli avvisi di avvio del progetto.",
  "dataExplorer.error": "Impossibile leggere lo schema: {error}",

  "dataExplorer.inSync": "Codice e database sono allineati",
  "dataExplorer.driftCount": "{count} differenza/e tra codice e database",
  "dataExplorer.driftHint": "Esegui le migrazioni del progetto per chiudere il divario.",
  "dataExplorer.noTables": "Nessuna tabella dichiarata in db/schema.ts e nessuna nel database.",
  "dataExplorer.notInCode": "Questa tabella esiste solo nel database.",
  "dataExplorer.noUsage": "Nessuna route usa questa tabella",
  "dataExplorer.usedBy": "Usata da {count} route",
  "dataExplorer.openTable": "Apri db/schema.ts",
  "dataExplorer.openRoute": "Apri {route}",
  "dataExplorer.pk": "Chiave primaria",
  "dataExplorer.nullable": "Nullable",
  "dataExplorer.default": "Default {value}",

  "dataExplorer.rls.policy": "RLS + policy",
  "dataExplorer.rls.rls_without_policy": "RLS attivo, nessuna policy",
  "dataExplorer.rls.rls_off_scoped": "RLS spento su tabella scoped",
  "dataExplorer.rls.rls_off": "RLS spento",
  "dataExplorer.rls.missing": "Non nel database",

  "dataExplorer.drift.table_missing": "La tabella {table} è nel codice ma non nel database",
  "dataExplorer.drift.table_extra": "La tabella {table} è nel database ma non nel codice",
  "dataExplorer.drift.column_missing":
    "La colonna {table}.{column} è nel codice ma non nel database",
  "dataExplorer.drift.column_extra": "La colonna {table}.{column} è nel database ma non nel codice",
  "dataExplorer.drift.column_type":
    "Colonna {table}.{column}: il codice dice {expected}, il database dice {actual}",
  "dataExplorer.drift.column_nullability":
    "Colonna {table}.{column}: il codice dice {expected}, il database dice {actual}",
  "dataExplorer.drift.rls_disabled": "RLS spento sulla tabella scoped {table}",
  "dataExplorer.drift.policy_missing": "La policy {policy} manca da {table}",
  "dataExplorer.drift.policy_extra": "La policy {policy} esiste su {table} ma non nel codice",
  "dataExplorer.drift.policy_changed": "La policy {policy} su {table} differisce dal codice",
};
