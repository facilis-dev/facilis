// The AI Chat sidebar (D-045). A thin view over ChatSession: the session owns the
// conversation, the provider call and the proposal; this file owns the layout and the two
// empty states (no project / no provider configured). The composer is ChatComposer.tsx.
//
// All strings go through t() and every colour is a role, so the panel lands
// compliant with D-043/D-044 from its first commit (ide/I18N.md).

import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import Sparkles from "~icons/lucide/sparkles";
import Settings from "~icons/lucide/settings";
import Plus from "~icons/lucide/plus";
import LoaderCircle from "~icons/lucide/loader-circle";
import FileText from "~icons/lucide/file-text";
import FoldVertical from "~icons/lucide/fold-vertical";
import { Button } from "@/components/ui/button";
import { ChatComposer } from "./ChatComposer";
import { ChatMessageView } from "./ChatMessageView";
import { ChatSummaryView } from "./ChatSummaryView";
import { ChatProposalView } from "./ChatProposalView";
import { ChatTraceView } from "./ChatTraceView";
import { ChatSettingsDialog } from "./ChatSettingsDialog";
import { useIde } from "./useIde";
import { chatFor } from "@/ai/chat-host";
import type { ChatFailure } from "@/ai/types";
import { t } from "@/i18n";

function errorText(failure: ChatFailure): string {
  switch (failure.kind) {
    case "aborted":
      return t("chat.error.aborted");
    case "network":
      return t("chat.error.network");
    case "http":
      return t("chat.error.http", { status: failure.status ?? "?" });
    case "stream":
      return t("chat.error.stream");
    case "empty":
      return t("chat.error.empty");
    case "unsupported":
      return t("chat.error.unsupported");
    case "validator":
      return t("chat.error.validator");
  }
}

function Welcome({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
      <Sparkles className="size-5 text-brand" />
      <p className="text-xs font-medium">{title}</p>
      <p className="text-[11px] text-muted-foreground">{body}</p>
      {children}
    </div>
  );
}

export function ChatPanel() {
  const { c, snap } = useIde();
  const chat = useMemo(() => chatFor(c), [c]);
  const state = useSyncExternalStore(chat.subscribe, chat.getSnapshot);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [busySeconds, setBusySeconds] = useState(0);
  // Remounts the composer (draft, pasted images) when the user starts a new chat.
  const [composerKey, setComposerKey] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);
  const hasProject = snap.workspaceFolders.length > 0;
  const busy = state.phase !== "idle";
  const hasConversation = state.messages.some((message) => message.content.length > 0);
  // Re-compacting an unchanged transcript would only spend a call: the marker already covers it.
  const alreadyCovered = state.summary !== null && state.summary.through >= state.messages.length;

  // Follow the newest message / card; the transcript is the panel's only scroll.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [
    state.messages.length,
    state.phase,
    state.proposal,
    state.applied,
    state.error,
    state.repair,
    state.trace.length,
    state.reasoning,
    state.exploring,
    state.patchParts,
  ]);

  // A quiet spinner is not enough: show how long the current step has been running.
  useEffect(() => {
    if (!busy) {
      setBusySeconds(0);
      return;
    }
    const started = Date.now();
    setBusySeconds(0);
    const timer = setInterval(() => {
      setBusySeconds(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const busyLabel =
    state.exploring !== null
      ? t("chat.exploring", { n: state.exploring })
      : state.repair !== null
        ? t("chat.repairing", { attempt: state.repair.attempt })
        : state.patchParts !== null
          ? t("chat.patchParts", { part: state.patchParts.part })
          : state.phase === "applying"
            ? t("chat.applying")
            : state.phase === "compacting"
              ? t("chat.compacting")
              : state.streaming
                ? t("chat.streaming")
                : t("chat.thinking");

  return (
    <aside
      className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground"
      aria-label={t("chat.title")}
      data-streaming={state.streaming ? "true" : "false"}
    >
      <div className="flex items-center justify-between gap-1 border-b px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <Sparkles className="size-3.5 shrink-0 text-brand" />
          <span className="truncate">{t("chat.title")}</span>
        </div>
        <div className="flex shrink-0 items-center">
          {hasProject && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("chat.instructions")}
              title={t("chat.instructions")}
              onClick={() => void chat.openInstructions()}
            >
              <FileText />
            </Button>
          )}
          {hasProject && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("chat.compact")}
              title={t("chat.compact")}
              disabled={busy || !state.configured || !hasConversation || alreadyCovered}
              onClick={() => void chat.compact()}
            >
              <FoldVertical />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("chat.newChat")}
            title={t("chat.newChat")}
            disabled={state.messages.length === 0}
            onClick={() => {
              chat.newChat();
              setComposerKey((key) => key + 1);
            }}
          >
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("chat.settings")}
            title={t("chat.settings")}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings />
          </Button>
        </div>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2 py-2">
        {!hasProject ? (
          <Welcome title={t("chat.empty.noProject")} body={t("chat.empty.noProjectBody")} />
        ) : !state.configured ? (
          <Welcome title={t("chat.empty.title")} body={t("chat.empty.body")}>
            <Button size="sm" onClick={() => setSettingsOpen(true)}>
              {t("chat.empty.configure")}
            </Button>
            <p className="text-[10px] text-muted-foreground">{t("chat.empty.privacy")}</p>
          </Welcome>
        ) : state.messages.length === 0 && !state.proposal && !state.error ? (
          <Welcome title={t("chat.empty.title")} body={t("chat.empty.body")} />
        ) : (
          <>
            {state.messages.map((message, index) => (
              <Fragment key={message.id}>
                <ChatMessageView
                  message={message}
                  streaming={state.streaming && index === state.messages.length - 1}
                />
                {state.summary !== null && index === state.summary.through - 1 && (
                  <ChatSummaryView summary={state.summary} />
                )}
              </Fragment>
            ))}
            <ChatTraceView
              trace={state.trace}
              exploring={state.exploring}
              reasoning={state.reasoning}
            />
            <ChatProposalView chat={chat} state={state} />
            {state.error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
                <p className="font-medium text-destructive">{errorText(state.error)}</p>
                {state.error.kind === "validator" && (
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {t("chat.validator.hint")}
                  </p>
                )}
                {state.error.message.length > 0 && (
                  <details className="mt-1 text-[10px] text-muted-foreground">
                    <summary className="cursor-pointer select-none">{t("chat.detail")}</summary>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono">
                      {state.error.message}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {busy && (
        // Outside the scrolling transcript on purpose: during PTC exploration the list
        // auto-scrolls on each run, so an in-list spinner could end up out of view.
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-1.5 border-t px-2 py-1.5 text-[11px] text-muted-foreground"
        >
          <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
          <span className="min-w-0 flex-1 truncate">{busyLabel}</span>
          <span className="shrink-0 font-mono tabular-nums">
            {t("chat.busy.elapsed", { seconds: busySeconds })}
          </span>
        </div>
      )}

      {hasProject && state.configured && (
        <ChatComposer key={composerKey} chat={chat} state={state} />
      )}

      <ChatSettingsDialog
        chat={chat}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        current={state.settings}
      />
    </aside>
  );
}
