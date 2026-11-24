import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { DatabaseSync } from "node:sqlite";
import type { RequestTelemetry } from "./telemetry/event-context";

/**
 * Declared table surface (the production analogue is `dbTables`): span attributes are
 * derived from this declaration, never from a query string or a bind value.
 */
export const DECLARED_TABLES = ["items"] as const;

const tracer = trace.getTracer("facilis-spike-db", "0.0.0");
const database = new DatabaseSync(":memory:");

database.exec("CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, label TEXT NOT NULL)");
database.exec("INSERT INTO items (id, label) VALUES (1, 'alpha'), (2, 'beta'), (3, 'gamma')");

export interface Item {
  readonly id: number;
  readonly label: string;
}

/** A driver-level DB span, child of the request span carried on the event. */
export function selectItems(telemetry: RequestTelemetry | null): Item[] {
  const span = tracer.startSpan(
    "SELECT " + DECLARED_TABLES[0],
    {
      kind: SpanKind.CLIENT,
      attributes: {
        "db.system": "sqlite",
        "db.operation": "select",
        "db.table": DECLARED_TABLES[0],
      },
    },
    telemetry?.context,
  );
  try {
    const rows = database.prepare("SELECT id, label FROM items ORDER BY id").all();
    return rows.map((row) => ({ id: Number(row.id), label: String(row.label) }));
  } catch (error) {
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw error;
  } finally {
    span.end();
  }
}
