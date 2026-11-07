// The chat activity timeline (D-101/D-110): one row per model call, inserted where the call
// starts so its reasoning streams inside that row, and one row per exploration program — in
// strict chronological order. Pure presentation: ChatSession owns the state.
//
// Every string is a t() key and every colour a semantic role (D-043/D-044).

import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ChatActivity, ChatTraceCall, ChatTraceRun } from "@/ai/types";

const OUTCOMES = {
  script: "chat.trace.outcome.script",
  part: "chat.trace.outcome.part",
  answer: "chat.trace.outcome.answer",
  rejected: "chat.trace.outcome.rejected",
  cut: "chat.trace.outcome.cut",
  failed: "chat.trace.outcome.failed",
} as const;

function CallCard({
  call,
  liveReasoning,
  latest,
}: {
  call: ChatTraceCall;
  /** The stream of this call while it runs; null once it finished. */
  liveReasoning: string | null;
  /** The newest call in the timeline: its row stays open so its reasoning is in view. */
  latest: boolean;
}) {
  const running = call.outcome === "running";
  const reasoning = running ? liveReasoning : (call.reasoning ?? null);
  const status = call.outcome === "running" ? t("chat.trace.running") : t(OUTCOMES[call.outcome]);
  return (
    <details
      className="rounded-md border border-border/60 bg-muted/30 p-1.5"
      aria-busy={running}
      open={running || latest}
    >
      <summary className="cursor-pointer select-none text-[11px]">
        <span className="font-medium">{t("chat.trace.call", { n: call.n })}</span>
        <span
          className={cn(
            "ml-1.5",
            running
              ? "text-muted-foreground"
              : call.outcome === "failed"
                ? "text-destructive"
                : "text-muted-foreground",
          )}
        >
          {status}
        </span>
        {!running && (
          <span className="ml-1.5 text-muted-foreground">
            {t("chat.trace.callMeta", { chars: call.chars, ms: call.elapsedMs })}
            {call.truncated ? " · " + t("chat.trace.truncated") : ""}
          </span>
        )}
      </summary>
      {reasoning !== null && reasoning.length > 0 && (
        <>
          <p className="mt-1 text-[10px] text-muted-foreground">{t("chat.trace.reasoning")}</p>
          <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-editor p-1 font-mono text-[10px] leading-4 text-editor-foreground">
            {reasoning}
          </pre>
        </>
      )}
    </details>
  );
}

function RunCard({
  run,
  number,
  running,
}: {
  run: ChatTraceRun;
  number: number;
  running: boolean;
}) {
  const status = running
    ? "…"
    : run.ok
      ? t("chat.trace.ok")
      : t("chat.trace.failed", { kind: run.error?.kind ?? "exception" });
  return (
    <details className="rounded-md border border-border/60 bg-muted/30 p-1.5" aria-busy={running}>
      <summary className="cursor-pointer select-none text-[11px]">
        <span className="font-medium">{t("chat.trace.run", { n: number })}</span>
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
  reasoning,
}: {
  trace: readonly ChatActivity[];
  /** The 1-based exploration program currently running, or null. */
  exploring: number | null;
  /** The reasoning streaming right now; the running call row renders it in place. */
  reasoning: string | null;
}) {
  if (trace.length === 0) return null;
  // Program numbers count programs only; model calls are numbered by the loop.
  const numbers = new Map<number, number>();
  let runs = 0;
  let lastCallIndex = -1;
  trace.forEach((entry, index) => {
    if (entry.kind === "run") {
      runs += 1;
      numbers.set(index, runs);
    } else {
      lastCallIndex = index;
    }
  });
  return (
    <section
      aria-label={t("chat.trace.title")}
      className="rounded-md border border-border/60 bg-card/40 p-2 text-xs"
    >
      <p className="font-medium">{t("chat.trace.title")}</p>
      <div className="mt-1 space-y-1">
        {trace.map((entry, index) =>
          entry.kind === "call" ? (
            <CallCard
              key={"call-" + String(index)}
              call={entry}
              liveReasoning={entry.outcome === "running" ? reasoning : null}
              latest={index === lastCallIndex}
            />
          ) : (
            <RunCard
              key={"run-" + String(index)}
              run={entry}
              number={numbers.get(index) ?? 0}
              running={exploring === numbers.get(index)}
            />
          ),
        )}
      </div>
    </section>
  );
}
