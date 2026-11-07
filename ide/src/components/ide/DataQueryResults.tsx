// The SQL console's result surface (D-097): the rows table, its counts/truncation footer and
// the error state. Pure presentation; the panel owns the request lifecycle.

import RefreshCw from "~icons/lucide/refresh-cw";
import { Button } from "@/components/ui/button";
import { t, type MessageKey } from "@/i18n";
import type { DevQueryResult, DevQueryValue } from "@/facilis/dev-query-client";

const ERROR_KEYS: Record<string, MessageKey> = {
  invalid_body: "dataQuery.code.invalid_body",
  invalid_sql: "dataQuery.code.invalid_sql",
  query_failed: "dataQuery.code.query_failed",
};

function failureMessage(result: Extract<DevQueryResult, { ok: false }>): string {
  const key = result.code === undefined ? undefined : ERROR_KEYS[result.code];
  return key === undefined ? t("dataQuery.error", { error: result.error }) : t(key);
}

function Cell({ value }: { value: DevQueryValue }) {
  if (value === null) {
    return <span className="italic text-muted-foreground">{t("dataQuery.null")}</span>;
  }
  // json/jsonb cells arrive as objects/arrays; show them as compact JSON, while
  // numbers/booleans stay plain text.
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return <span title={text}>{text}</span>;
}

export function DataQueryResults({
  result,
  onRetry,
}: {
  result: DevQueryResult;
  onRetry: () => void;
}) {
  if (!result.ok) {
    return (
      <div
        data-testid="data-query-error"
        className="m-2 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs"
      >
        <p className="font-medium text-destructive">{failureMessage(result)}</p>
        <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
          {result.status === 0
            ? t("dataQuery.network")
            : t("dataQuery.httpStatus", { status: result.status })}
          {result.code === undefined ? "" : " · " + result.code}
          {result.message === undefined ? "" : " · " + result.message}
        </p>
        <Button variant="ghost" size="xs" className="mt-1" onClick={onRetry}>
          <RefreshCw />
          {t("dataQuery.retry")}
        </Button>
      </div>
    );
  }

  const data = result.data;
  return (
    <div data-testid="data-query-results" className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {data.rows.length === 0 ? (
          <p className="px-3 py-4 text-[11px] text-muted-foreground">{t("dataQuery.noRows")}</p>
        ) : (
          <table className="w-max min-w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-muted text-[10px] text-muted-foreground">
              <tr>
                {data.columns.map((column) => (
                  <th
                    key={column.name}
                    className="border-b px-2 py-1 font-medium whitespace-nowrap"
                  >
                    <span className="font-mono text-foreground">{column.name}</span>
                    <span className="ml-1 text-muted-foreground">{column.pgType}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row, rowIndex) => (
                <tr
                  key={rowIndex}
                  data-testid="data-query-row"
                  className="border-b last:border-0 hover:bg-accent/50"
                >
                  {row.map((value, columnIndex) => (
                    <td
                      key={columnIndex}
                      className="px-2 py-0.5 align-top font-mono text-[11px] whitespace-nowrap"
                    >
                      <Cell value={value} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="shrink-0 space-y-0.5 border-t px-2 py-1.5 text-[10px] text-muted-foreground">
        <p className="flex flex-wrap items-center gap-2">
          <span>{t("dataQuery.rowCount", { count: data.rowCount })}</span>
          <span>{t("dataQuery.elapsed", { ms: data.elapsedMs })}</span>
          {data.truncated && <span className="text-warning">{t("dataQuery.truncated")}</span>}
        </p>
        <p className="text-warning">{t("dataQuery.rlsWarning")}</p>
      </div>
    </div>
  );
}
