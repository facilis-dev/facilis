// The PTC exploration card (D-101, docs/PTC.md §10): which programs the model ran, the
// tools each called with duration/size, and the typed error of a failed program.
//
// Pure presentation: ChatSession owns the state. Every string is a t() key and every colour
// a semantic role (D-043/D-044).

import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ChatTraceRun } from "@/ai/types";

function RunCard({
  run,
  index,
  exploring,
}: {
  run: ChatTraceRun;
  index: number;
  exploring: number | null;
}) {
  const running = exploring === index + 1;
  const status = running
    ? "…"
    : run.ok
      ? t("chat.trace.ok")
      : t("chat.trace.failed", { kind: run.error?.kind ?? "exception" });
  return (
    <details className="rounded-md border border-border/60 bg-muted/30 p-1.5" aria-busy={running}>
      <summary className="cursor-pointer select-none text-[11px]">
        <span className="font-medium">{t("chat.trace.run", { n: index + 1 })}</span>
        <span
          className={cn(
            "ml-1.5",
            running ? "text-muted-foreground" : run.ok ? "text-success" : "text-destructive",
          )}
        >
          {status}
        </span>
        <span className="ml-1.5 text-muted-foreground">
          {t("chat.trace.tools", { n: run.toolCalls })} · {run.elapsedMs} ms
        </span>
      </summary>
      {run.error && (
        <p className="mt-1 whitespace-pre-wrap break-words text-[10px] text-destructive">
          {run.error.message}
        </p>
      )}
      <p className="mt-1 text-[10px] text-muted-foreground">{t("chat.trace.program")}</p>
      <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-editor p-1 font-mono text-[10px] leading-4 text-editor-foreground">
        {run.program}
      </pre>
      {run.entries.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {run.entries.map((entry, entryIndex) => (
            <li key={entryIndex} className="flex flex-wrap items-baseline gap-x-1.5 text-[10px]">
              <span className={cn("font-mono", entry.ok ? "text-success" : "text-destructive")}>
                {entry.ok ? "✓" : "✗"}
              </span>
              <span className="font-mono">{entry.name}</span>
              <span className="min-w-0 truncate font-mono text-muted-foreground">{entry.args}</span>
              <span className="ml-auto shrink-0 font-mono text-muted-foreground">
                {entry.durationMs} ms · {entry.bytes} B
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export function ChatTraceView({
  trace,
  exploring,
}: {
  trace: readonly ChatTraceRun[];
  exploring: number | null;
}) {
  if (trace.length === 0) return null;
  return (
    <section
      aria-label={t("chat.trace.title")}
      className="rounded-md border border-border/60 bg-card/40 p-2 text-xs"
    >
      <p className="font-medium">{t("chat.trace.title")}</p>
      <div className="mt-1 space-y-1">
        {trace.map((run, index) => (
          <RunCard key={index} run={run} index={index} exploring={exploring} />
        ))}
      </div>
    </section>
  );
}
