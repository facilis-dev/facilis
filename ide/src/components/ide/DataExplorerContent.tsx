// The Entity Explorer's rendered body: RLS badges, the drift list, columns and the
// "used by" reverse lookup (SPEC §11.1). Pure presentation over the view model; the
// panel owns fetching and refresh.

import Check from "~icons/lucide/check";
import KeyRound from "~icons/lucide/key-round";
import TriangleAlert from "~icons/lucide/triangle-alert";
import { t, type MessageKey } from "@/i18n";
import type { ExplorerColumn, SchemaDriftEntry } from "@/facilis/data-explorer-client";
import type {
  ExplorerRouteUsage,
  ExplorerTable,
  ExplorerView,
  RlsStatus,
} from "@/facilis/data-explorer-model";

interface ContentProps {
  view: ExplorerView;
  onOpenTable: () => void;
  onOpenRoute: (usage: ExplorerRouteUsage) => void;
  linksDisabled: boolean;
}

export function DataExplorerContent({
  view,
  onOpenTable,
  onOpenRoute,
  linksDisabled,
}: ContentProps) {
  if (view.tables.length === 0) {
    return (
      <p className="px-1 py-4 text-[11px] text-muted-foreground">{t("dataExplorer.noTables")}</p>
    );
  }
  return (
    <div className="space-y-2">
      <DriftSummary view={view} />
      {view.tables.map((table) => (
        <TableSection
          key={table.name}
          table={table}
          onOpenTable={onOpenTable}
          onOpenRoute={onOpenRoute}
          linksDisabled={linksDisabled}
        />
      ))}
    </div>
  );
}

function DriftSummary({ view }: { view: ExplorerView }) {
  if (view.synced) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border border-success/40 bg-success/10 px-2 py-1.5 text-[11px] text-success">
        <Check className="size-3.5 shrink-0" />
        {t("dataExplorer.inSync")}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-warning">
        <TriangleAlert className="size-3.5 shrink-0" />
        {t("dataExplorer.driftCount", { count: view.drift.length })}
      </p>
      <ul className="mt-1 space-y-0.5">
        {view.drift.map((entry, index) => (
          <li key={driftKey(entry, index)} className="text-[10px] text-muted-foreground">
            {driftMessage(entry)}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-[10px] text-muted-foreground">{t("dataExplorer.driftHint")}</p>
    </div>
  );
}

function driftKey(entry: SchemaDriftEntry, index: number): string {
  return [entry.kind, entry.table, entry.column ?? "", entry.policy ?? "", index].join(":");
}

function driftMessage(entry: SchemaDriftEntry): string {
  switch (entry.kind) {
    case "table_missing":
      return t("dataExplorer.drift.table_missing", { table: entry.table });
    case "table_extra":
      return t("dataExplorer.drift.table_extra", { table: entry.table });
    case "column_missing":
      return t("dataExplorer.drift.column_missing", {
        table: entry.table,
        column: entry.column ?? "",
      });
    case "column_extra":
      return t("dataExplorer.drift.column_extra", {
        table: entry.table,
        column: entry.column ?? "",
      });
    case "column_type":
      return t("dataExplorer.drift.column_type", {
        table: entry.table,
        column: entry.column ?? "",
        expected: entry.expected ?? "",
        actual: entry.actual ?? "",
      });
    case "column_nullability":
      return t("dataExplorer.drift.column_nullability", {
        table: entry.table,
        column: entry.column ?? "",
        expected: entry.expected ?? "",
        actual: entry.actual ?? "",
      });
    case "rls_disabled":
      return t("dataExplorer.drift.rls_disabled", { table: entry.table });
    case "policy_missing":
      return t("dataExplorer.drift.policy_missing", {
        table: entry.table,
        policy: entry.policy ?? "",
      });
    case "policy_extra":
      return t("dataExplorer.drift.policy_extra", {
        table: entry.table,
        policy: entry.policy ?? "",
      });
    case "policy_changed":
      return t("dataExplorer.drift.policy_changed", {
        table: entry.table,
        policy: entry.policy ?? "",
      });
  }
}

function TableSection({
  table,
  onOpenTable,
  onOpenRoute,
  linksDisabled,
}: {
  table: ExplorerTable;
  onOpenTable: () => void;
  onOpenRoute: (usage: ExplorerRouteUsage) => void;
  linksDisabled: boolean;
}) {
  return (
    <section data-testid="data-explorer-table" className="rounded-md border bg-background/40">
      <div className="flex items-start gap-1 px-2 py-1.5">
        <button
          type="button"
          disabled={linksDisabled}
          onClick={onOpenTable}
          title={t("dataExplorer.openTable")}
          className="min-w-0 flex-1 truncate text-left font-mono text-[11px] font-medium hover:text-primary hover:underline disabled:opacity-100 disabled:hover:text-inherit disabled:hover:no-underline"
        >
          {table.name}
        </button>
        <RlsBadge status={table.rls} />
      </div>
      {!table.inCode && (
        <p className="px-2 pb-1 text-[10px] text-warning">{t("dataExplorer.notInCode")}</p>
      )}
      <ul className="border-t">
        {table.columns.map((column) => (
          <ColumnRow key={column.name} column={column} />
        ))}
      </ul>
      <Usage table={table} onOpenRoute={onOpenRoute} linksDisabled={linksDisabled} />
    </section>
  );
}

function ColumnRow({ column }: { column: ExplorerColumn }) {
  return (
    <li className="flex items-baseline gap-1.5 px-2 py-0.5 font-mono text-[11px]">
      {column.primaryKey && (
        <KeyRound className="size-3 shrink-0 text-warning" aria-label={t("dataExplorer.pk")} />
      )}
      <span className="min-w-0 truncate">{column.name}</span>
      <span
        className="ml-auto shrink-0 text-[10px] text-muted-foreground"
        title={
          column.default === null ? undefined : t("dataExplorer.default", { value: column.default })
        }
      >
        {column.type}
      </span>
      {!column.notNull && (
        <span
          className="shrink-0 text-[10px] text-muted-foreground"
          title={t("dataExplorer.nullable")}
        >
          ?
        </span>
      )}
    </li>
  );
}

function Usage({
  table,
  onOpenRoute,
  linksDisabled,
}: {
  table: ExplorerTable;
  onOpenRoute: (usage: ExplorerRouteUsage) => void;
  linksDisabled: boolean;
}) {
  return (
    <div className="border-t px-2 py-1.5">
      <p className="text-[10px] text-muted-foreground">
        {table.usedBy.length === 0
          ? t("dataExplorer.noUsage")
          : t("dataExplorer.usedBy", { count: table.usedBy.length })}
      </p>
      {table.usedBy.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1">
          {table.usedBy.map((usage) => (
            <li key={usage.method + " " + usage.path}>
              <button
                type="button"
                disabled={linksDisabled || usage.sourceFile === null}
                onClick={() => onOpenRoute(usage)}
                title={t("dataExplorer.openRoute", { route: usage.method + " " + usage.path })}
                className="rounded border px-1 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-ring hover:text-foreground disabled:opacity-60"
              >
                {usage.method} {usage.path}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const RLS_BADGES: Record<RlsStatus, { label: MessageKey; className: string }> = {
  policy: {
    label: "dataExplorer.rls.policy",
    className: "border-success/40 bg-success/10 text-success",
  },
  rls_without_policy: {
    label: "dataExplorer.rls.rls_without_policy",
    className: "border-warning/40 bg-warning/10 text-warning",
  },
  rls_off_scoped: {
    label: "dataExplorer.rls.rls_off_scoped",
    className: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  rls_off: {
    label: "dataExplorer.rls.rls_off",
    className: "border-border bg-muted text-muted-foreground",
  },
  missing: {
    label: "dataExplorer.rls.missing",
    className: "border-destructive/40 bg-destructive/10 text-destructive",
  },
};

function RlsBadge({ status }: { status: RlsStatus }) {
  const badge = RLS_BADGES[status];
  return (
    <span
      className={
        "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium " + badge.className
      }
    >
      {t(badge.label)}
    </span>
  );
}
