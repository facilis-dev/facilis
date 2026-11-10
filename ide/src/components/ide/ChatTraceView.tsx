// The chat activity timeline (D-101/D-110, lighter in D-114/CHAT-UX): one line per model call,
// inserted where the call starts so its reasoning streams inside that line, and one line per
// exploration program — strict chronological order, no card chrome. Pure presentation:
// ChatSession owns the state.
//
// Every string is a t() key and every colour a semantic role (D-043/D-044).

import type { ReactNode } from "react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import Brain from "~icons/lucide/brain";
import Terminal from "~icons/lucide/terminal";
import LoaderCircle from "~icons/lucide/loader-circle";
import type { ChatActivity, ChatTraceCall, ChatTraceRun } from "@/ai/types";

const OUTCOMES = {
  script: "chat.trace.outcome.script",
  part: "chat.trace.outcome.part",
  answer: "chat.trace.outcome.answer",
  rejected: "chat.trace.outcome.rejected",
  cut: "chat.trace.outcome.cut",
  failed: "chat.trace.outcome.failed",
} as const;

/** The shared row line: icon, title, status, and a right-aligned meta column. */
function Row({
  icon,
  title,
  status,
  statusClass,
  meta,
  busy,
  open,
  children,
}: {
  icon: "call" | "run";
  title: string;
  status: string;
  statusClass: string;
  meta: string;
  busy: boolean;
  open?: boolean;
  children: ReactNode;
}) {
  const Icon = icon === "call" ? Brain : Terminal;
  return (
    <details aria-busy={busy} open={open}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded px-1 py-0.5 text-[11px] hover:bg-muted/40">
        {busy ? (
          <LoaderCircle className="size-3 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Icon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="shrink-0 font-medium">{title}</span>
        <span className={cn("truncate", statusClass)}>{status}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">{meta}</span>
      </summary>
      <div className="mt-0.5 pl-5">{children}</div>
    </details>
  );
}

function CallRow({
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
  return (
    <Row
      icon="call"
      title={t("chat.trace.call", { n: call.n })}
      status={call.outcome === "running" ? t("chat.trace.running") : t(OUTCOMES[call.outcome])}
      statusClass={call.outcome === "failed" ? "text-destructive" : "text-muted-foreground"}
      meta={
        running
          ? ""
          : t("chat.trace.callMeta", { chars: call.chars, ms: call.elapsedMs }) +
            (call.truncated ? " · " + t("chat.trace.truncated") : "")
      }
      busy={running}
      open={running || latest}
    >
      {reasoning !== null && reasoning.length > 0 && (
        <>
          <p className="text-[10px] text-muted-foreground">{t("chat.trace.reasoning")}</p>
          <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground">
            {reasoning}
          </p>
        </>
      )}
    </Row>
  );
}

function RunRow({ run, number, running }: { run: ChatTraceRun; number: number; running: boolean }) {
  return (
    <Row
      icon="run"
      title={t("chat.trace.run", { n: number })}
      status={
        running
          ? "…"
          : run.ok
            ? t("chat.trace.ok")
            : t("chat.trace.failed", { kind: run.error?.kind ?? "exception" })
      }
      statusClass={running ? "text-muted-foreground" : run.ok ? "text-success" : "text-destructive"}
      meta={t("chat.trace.tools", { n: run.toolCalls }) + " · " + run.elapsedMs + " ms"}
      busy={running}
    >
      {run.error && (
        <p className="whitespace-pre-wrap break-words text-[10px] text-destructive">
          {run.error.message}
        </p>
      )}
      {run.images !== undefined && run.images.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {run.images.map((src, imageIndex) => (
            <a key={imageIndex} href={src} target="_blank" rel="noreferrer">
              <img
                src={src}
                alt={t("chat.trace.screenshot", { n: imageIndex + 1 })}
                className="max-h-36 rounded border border-border/60"
              />
            </a>
          ))}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">{t("chat.trace.program")}</p>
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
    </Row>
  );
}

export function ChatTraceView({
  trace,
  exploring,
  reasoning,
  live = true,
}: {
  trace: readonly ChatActivity[];
  /** The 1-based exploration program currently running, or null. */
  exploring: number | null;
  /** The reasoning streaming right now; the running call row renders it in place. */
  reasoning: string | null;
  /**
   * The current turn: its newest call row stays open so its reasoning is in view. A persisted
   * turn's rows stay collapsed (the reasoning is still there, one click away).
   */
  live?: boolean;
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
    <section aria-label={t("chat.trace.title")} className="space-y-0.5 text-xs">
      {trace.map((entry, index) =>
        entry.kind === "call" ? (
          <CallRow
            key={"call-" + String(index)}
            call={entry}
            liveReasoning={entry.outcome === "running" ? reasoning : null}
            latest={live && index === lastCallIndex}
          />
        ) : (
          <RunRow
            key={"run-" + String(index)}
            run={entry}
            number={numbers.get(index) ?? 0}
            running={exploring === numbers.get(index)}
          />
        ),
      )}
    </section>
  );
}
