// The turn-writes summary (D-181): exactly which source files the AI wrote in the live turn,
// with the line counts and an Undo that restores those paths from the HEAD commit the clean-tree
// gate recorded. The session clears state.writes after a successful undo, so this block
// disappears with it.
//
// Rows are listed rather than opened here: the transcript already links files, and the sidebar
// is narrow. A destructive write (rule 15: a dropped table or column) is flagged so it is not
// undone by accident.

import { useState } from "react";
import FilePenLine from "~icons/lucide/file-pen-line";
import FilePlus2 from "~icons/lucide/file-plus-2";
import Trash2 from "~icons/lucide/trash-2";
import TriangleAlert from "~icons/lucide/triangle-alert";
import { Button } from "@/components/ui/button";
import type { ChatSession } from "@/ai/chat-session";
import type { ChatState, ChatTurnWrite } from "@/ai/types";
import { t } from "@/i18n";

function actionLabel(action: ChatTurnWrite["action"]): string {
  switch (action) {
    case "create":
      return t("chat.writes.action.create");
    case "update":
      return t("chat.writes.action.update");
    case "delete":
      return t("chat.writes.action.delete");
  }
}

function ActionIcon({ action }: { action: ChatTurnWrite["action"] }) {
  switch (action) {
    case "create":
      return <FilePlus2 className="size-3 shrink-0 text-success" />;
    case "update":
      return <FilePenLine className="size-3 shrink-0 text-warning" />;
    case "delete":
      return <Trash2 className="size-3 shrink-0 text-destructive" />;
  }
}

export function ChatWritesView({ chat, state }: { chat: ChatSession; state: ChatState }) {
  const [undoing, setUndoing] = useState(false);
  const count = state.writes.length;

  if (count === 0) return null;

  async function undo(): Promise<void> {
    setUndoing(true);
    try {
      await chat.gitGate.undo();
    } finally {
      // On failure the session shows its own error and keeps the list, so re-enable Undo.
      setUndoing(false);
    }
  }

  return (
    <div
      className="rounded-md border bg-card p-2 text-xs"
      aria-label={t("chat.writes.title", { n: count })}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 flex-1 truncate font-medium">
          {t("chat.writes.title", { n: count })}
        </p>
        <Button
          variant="ghost"
          size="xs"
          disabled={undoing || state.phase !== "idle"}
          onClick={() => void undo()}
        >
          {undoing ? t("chat.writes.undoing") : t("chat.writes.undo")}
        </Button>
      </div>
      <ul className="mt-1 space-y-0.5">
        {/* A turn may write the same path twice (create, then update): the index keeps keys unique. */}
        {state.writes.map((write, index) => (
          <li
            key={write.path + ":" + write.action + ":" + index}
            className="flex items-center gap-1.5"
          >
            <ActionIcon action={write.action} />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={write.path}>
              {write.path}
            </span>
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {actionLabel(write.action)}
            </span>
            <span className="shrink-0 font-mono text-[10px]">
              <span className="text-success">+{write.added}</span>{" "}
              <span className="text-destructive">-{write.removed}</span>
            </span>
            {write.destructive && (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 rounded bg-destructive/10 px-1 text-[9px] font-medium text-destructive"
                title={t("chat.writes.destructiveHint")}
              >
                <TriangleAlert className="size-2.5" />
                {t("chat.writes.destructive")}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
