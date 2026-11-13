// The clean-tree gate card (D-181): the turn pauses before the AI's first source write when
// the project is not a git repository, has no commit yet, or has uncommitted changes. The user
// chooses "commit and continue" or "stop"; nothing is written while the gate is pending. The
// session clears state.gitGate on either choice, which is what unmounts this card.
//
// Committing is asynchronous and can fail (no git identity, for example): the failure stays in
// gitGate.error, so the buttons disable and show a busy label until the action settles.

import { useState } from "react";
import GitBranch from "~icons/lucide/git-branch";
import TriangleAlert from "~icons/lucide/triangle-alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatSession } from "@/ai/chat-session";
import type { ChatGitChange, ChatGitGateFailure, ChatState } from "@/ai/types";
import { t } from "@/i18n";

/** How many changed paths to spell out before collapsing the rest into a count. */
const MAX_VISIBLE_CHANGES = 6;

// The letter is git's own status code; the role colour keeps it readable in every theme.
const LETTER_CLASS: Record<ChatGitChange["letter"], string> = {
  A: "text-success",
  M: "text-warning",
  D: "text-destructive",
  U: "text-muted-foreground",
};

function titleOf(failure: ChatGitGateFailure): string {
  switch (failure.code) {
    case "no-repo":
      return t("chat.gitGate.title.noRepo");
    case "no-head":
      return t("chat.gitGate.title.noHead");
    case "dirty-tree":
      return t("chat.gitGate.title.dirtyTree");
  }
}

function bodyOf(failure: ChatGitGateFailure): string {
  switch (failure.code) {
    case "no-repo":
      return t("chat.gitGate.body.noRepo");
    case "no-head":
      return t("chat.gitGate.body.noHead");
    case "dirty-tree":
      return t("chat.gitGate.body.dirtyTree");
  }
}

export function ChatGitGateView({ chat, state }: { chat: ChatSession; state: ChatState }) {
  // Local pending flag: the session owns the outcome, this only keeps the card from
  // accepting a second click while the commit is in flight.
  const [pending, setPending] = useState<"continue" | "stop" | null>(null);
  const gate = state.gitGate;

  if (gate === null) return null;

  const busy = pending !== null;
  const title = titleOf(gate.failure);
  const changes = gate.failure.code === "dirty-tree" ? gate.failure.changes : [];
  const visible = changes.slice(0, MAX_VISIBLE_CHANGES);
  const hidden = changes.length - visible.length;
  const primary =
    gate.failure.code === "no-repo" ? t("chat.gitGate.primaryInit") : t("chat.gitGate.primary");
  const busyLabel = pending === "stop" ? t("chat.gitGate.stopping") : t("chat.gitGate.committing");

  async function continueGate(): Promise<void> {
    setPending("continue");
    try {
      await chat.gitGate.continue();
    } finally {
      // A failed commit leaves the gate up with gitGate.error; a successful one clears it.
      setPending(null);
    }
  }

  function stopGate(): void {
    setPending("stop");
    chat.gitGate.stop();
    // stop() is synchronous and clears the gate, but the component stays mounted: reset the
    // flag so a later gate in this session does not inherit a disabled card.
    setPending(null);
  }

  return (
    <div
      className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs"
      aria-label={title}
      aria-busy={busy}
    >
      <div className="flex items-center gap-1.5">
        {gate.failure.code === "dirty-tree" ? (
          <TriangleAlert className="size-3.5 shrink-0 text-warning" />
        ) : (
          <GitBranch className="size-3.5 shrink-0 text-warning" />
        )}
        <p className="font-medium text-warning">{title}</p>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{bodyOf(gate.failure)}</p>

      {visible.length > 0 && (
        <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto rounded border border-border/60 bg-card px-1.5 py-1 font-mono text-[11px]">
          {visible.map((change) => (
            <li key={change.path} className="flex items-center gap-1.5">
              <span className={cn("w-3 shrink-0 font-medium", LETTER_CLASS[change.letter])}>
                {change.letter}
              </span>
              <span className="min-w-0 flex-1 truncate" title={change.path}>
                {change.path}
              </span>
            </li>
          ))}
          {hidden > 0 && (
            <li className="text-[10px] text-muted-foreground">
              {t("chat.gitGate.more", { n: hidden })}
            </li>
          )}
        </ul>
      )}

      <div className="mt-1.5 flex items-center gap-1.5">
        <Button size="sm" disabled={busy} onClick={() => void continueGate()}>
          {busy ? busyLabel : primary}
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={stopGate}>
          {t("chat.gitGate.secondary")}
        </Button>
      </div>

      {gate.error !== null && (
        <p className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded border border-destructive/40 bg-destructive/5 px-1.5 py-1 font-mono text-[10px] text-destructive">
          {gate.error}
        </p>
      )}

      <p className="mt-1.5 text-[10px] text-muted-foreground">{t("chat.gitGate.explanation")}</p>
    </div>
  );
}
