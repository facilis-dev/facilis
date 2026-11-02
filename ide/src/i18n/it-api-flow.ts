// The Italian half of the API Flow block (see en-api-flow.ts); spread into `it`.
import type { MessageKey } from "./index";

export const apiFlowIt: Partial<Record<MessageKey, string>> = {
  "activity.apiFlow": "Flusso API",

  "apiFlow.title": "Flusso API",
  "apiFlow.refresh": "Aggiorna il grafo API",
  "apiFlow.retry": "Riprova",
  "apiFlow.unreachable": "Progetto non raggiungibile",
  "apiFlow.unreachableHint": "Avvia il progetto per leggerne il /_openapi.json.",
  "apiFlow.loading": "Lettura del documento OpenAPI…",
  "apiFlow.error": "Impossibile leggere il grafo API: {error}",
  "apiFlow.empty": "Nessuna route nel documento OpenAPI.",
  "apiFlow.emptyHint": "Aggiungi una route in server/routes — compare qui.",
  "apiFlow.openapiDisabled":
    "OpenAPI è disattivato per questo progetto. Attiva experimental.openAPI in nitro.config.ts.",

  "apiFlow.warnings": "{count} avviso/i segnalato/i",
  "apiFlow.stats": "{routes} route · {tables} tabelle · {edges} archi",
  "apiFlow.legend": "Legenda",
  "apiFlow.legendRoute": "route",
  "apiFlow.legendTable": "tabella",
  "apiFlow.legendColumnEdge": "tratteggio: solo a livello di colonna",
  "apiFlow.methodCount": "{method} {count}",

  "apiFlow.routeTables": "{count} tabelle",
  "apiFlow.tableColumns": "{count} colonne",
  "apiFlow.tableRoutes": "{count} route",
  "apiFlow.permission": "Richiede {permission}",
  "apiFlow.openRoute": "Apri {route}",
  "apiFlow.openTable": "Apri db/schema.ts",
};
