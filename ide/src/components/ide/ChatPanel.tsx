// The AI Chat sidebar (D-045). A thin view over ChatSession: the session owns the
// conversation, the provider call and the proposal; this file owns layout, the
// composer and the two empty states (no project / no provider configured).
//
// All strings go through t() and every colour is a role, so the panel lands
// compliant with D-043/D-044 from its first commit (ide/I18N.md).

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Sparkles from "~icons/lucide/sparkles";
import Settings from "~icons/lucide/settings";
import Plus from "~icons/lucide/plus";
import SendHorizontal from "~icons/lucide/send-horizontal";
import Square from "~icons/lucide/square";
import LoaderCircle from "~icons/lucide/loader-circle";
import FileText from "~icons/lucide/file-text";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ChatMessageView } from "./ChatMessageView";
import { ChatProposalView } from "./ChatProposalView";
import { ChatSettingsDialog } from "./ChatSettingsDialog";
import { useIde } from "./useIde";
import { chatFor } from "@/ai/chat-host";
import { providerById } from "@/ai/providers";
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
    case "parse":
      return t("chat.parse.error");
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
  const [draft, setDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const hasProject = snap.workspaceFolders.length > 0;
  const busy = state.phase !== "idle";
  const preset = state.settings ? providerById(state.settings.providerId) : undefined;

  // Follow the newest message / card; the transcript is the panel's only scroll.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [state.messages.length, state.phase, state.proposal, state.applied, state.error]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    void chat.send(text);
  };

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
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("chat.newChat")}
            title={t("chat.newChat")}
            disabled={state.messages.length === 0}
            onClick={() => chat.newChat()}
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

      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-2">
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
              <ChatMessageView
                key={message.id}
                message={message}
                streaming={state.streaming && index === state.messages.length - 1}
              />
            ))}
            <ChatProposalView chat={chat} state={state} />
            {state.error && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs">
                <p className="font-medium text-destructive">{errorText(state.error)}</p>
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
        {busy && !state.streaming && (
          <div className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" />
            {t("chat.thinking")}
          </div>
        )}
      </div>

      {hasProject && state.configured && (
        <div className="border-t p-2">
          <Textarea
            rows={3}
            className="max-h-40 min-h-16 resize-none text-xs"
            placeholder={t("chat.placeholder")}
            aria-label={t("chat.placeholder")}
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              submit();
            }}
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground">
              {t("chat.footer")}
            </p>
            {busy ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("chat.stop")}
                title={t("chat.stop")}
                onClick={() => chat.cancel()}
              >
                <Square />
              </Button>
            ) : (
              <Button
                size="icon-sm"
                aria-label={t("chat.send")}
                title={t("chat.send")}
                disabled={draft.trim().length === 0}
                onClick={submit}
              >
                <SendHorizontal />
              </Button>
            )}
          </div>
          <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
            {state.context
              ? t("chat.context", {
                  manifest: state.context.manifestRevision
                    ? t("chat.context.manifest", { revision: state.context.manifestRevision })
                    : t("chat.context.noManifest"),
                  files: state.context.files,
                }) + (state.context.instructions ? " · " + t("chat.context.agents") : "")
              : preset
                ? t("chat.configured", {
                    provider: t(preset.labelKey),
                    model: state.settings?.model ?? "",
                  })
                : ""}
          </p>
        </div>
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
