// The Logs panel's presentational parts (rows, filters, states). Split from
// LogsPanel.tsx to stay under the 300-line source limit, the same way other panels keep
// their rows/sections in a *Parts file.
//
// Every string is a t() key and every colour a semantic role (D-043/D-044).

import ScrollText from "~icons/lucide/scroll-text";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { t, type MessageKey } from "@/i18n";
import { formatLogTime, type LogEntry } from "@/facilis/logs-model";

/** One row: the summary line, expanding to the entry's JSON. Details row stays read-only. */
export function LogRow({ entry }: { entry: LogEntry }) {
  const levelLabel =
    entry.level === "unknown" ? t("logs.kind.unknown") : t(LEVEL_LABELS[entry.level]);
  const kindLabel = entry.kind === "unknown" ? t("logs.kind.unknown") : t(KIND_LABELS[entry.kind]);
  return (
    <li>
      <details>
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded px-1 py-0.5 text-[11px] hover:bg-muted/40">
          <span
            title={t("logs.timeUtc")}
            className="shrink-0 font-mono text-[10px] text-muted-foreground"
          >
            {formatLogTime(entry.ts)}
          </span>
          <span
            className={cn(
              "shrink-0 rounded border px-1 text-[9px] font-medium uppercase",
              levelClass(entry.level),
            )}
          >
            {levelLabel}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">{kindLabel}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{entry.summary}</span>
        </summary>
        <div className="mt-0.5 space-y-1 pl-2">
          {entry.corrupt ? <p className="text-[10px] text-warning">{t("logs.corrupt")}</p> : null}
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-editor p-1 font-mono text-[10px] leading-4 text-editor-foreground">
            {entry.raw === null ? entry.summary : JSON.stringify(entry.raw, null, 2)}
          </pre>
        </div>
      </details>
    </li>
  );
}

/** A labelled row of chips: one "All" plus every value of the generic list. */
export function FilterChips<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: T | "all";
  options: readonly T[];
  labels: Record<T, MessageKey>;
  onChange: (value: T | "all") => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <Chip active={value === "all"} onClick={() => onChange("all")}>
        {t("logs.filterAll")}
      </Chip>
      {options.map((option) => (
        <Chip key={option} active={value === option} onClick={() => onChange(option)}>
          {t(labels[option])}
        </Chip>
      ))}
    </div>
  );
}

/** The empty state: expected path (or "open a project") and nothing noisy. */
export function LogsEmptyState({ title, body }: { title?: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
      <ScrollText className="size-5 text-muted-foreground" />
      {title ? <p className="text-xs font-medium">{title}</p> : null}
      <p className="break-all text-[11px] text-muted-foreground">{body}</p>
    </div>
  );
}

/** A VFS read failure, with the reason and a retry. */
export function LogsErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
      <p className="whitespace-pre-wrap break-words font-medium text-destructive">
        {t("logs.error", { error })}
      </p>
      <Button variant="ghost" size="xs" className="mt-1" onClick={onRetry}>
        {t("logs.retry")}
      </Button>
    </div>
  );
}

const KIND_LABELS: Record<LogEntry["kind"] & string, MessageKey> = {
  access: "logs.kind.access",
  audit: "logs.kind.audit",
  error: "logs.kind.error",
  app: "logs.kind.app",
  unknown: "logs.kind.unknown",
};

const LEVEL_LABELS: Record<LogEntry["level"] & string, MessageKey> = {
  debug: "logs.level.debug",
  info: "logs.level.info",
  warn: "logs.level.warn",
  error: "logs.level.error",
  unknown: "logs.level.unknown",
};

function levelClass(level: LogEntry["level"]): string {
  if (level === "error") return "border-destructive/40 text-destructive";
  if (level === "warn") return "border-warning/40 text-warning";
  if (level === "info") return "border-info/40 text-info";
  return "border-border text-muted-foreground";
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded border px-1 py-0.5 text-[10px] transition-colors",
        active
          ? "border-primary/60 bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
