// The git-changes summary under the conversation (D-192). The chat no longer ends on a
// proposal card: the assistant writes the files, and the work lands outside the transcript,
// in a persistent footer at the bottom of the panel. It shows the working tree as Source
// Control sees it (staged and unstaged), so the user can review what changed without
// scrolling the conversation, undo the AI's turn, or jump to the Source Control panel.
//
// Store-driven: the SCM session is the source of truth (a discard or commit elsewhere updates
// this footer too). Rows are listed rather than opened: the transcript already links files.

import { useState, useSyncExternalStore } from "react";
import GitBranch from "~icons/lucide/git-branch";
import TriangleAlert from "~icons/lucide/triangle-alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatSession } from "@/ai/chat-session";
import type { ChatState, ChatTurnWrite } from "@/ai/types";
import type { IdeController } from "@/vv/controller";
import type { ChangeLetter, RepoState } from "@/vv/scm-session";
import { t } from "@/i18n";

/** How many changed paths to spell out before collapsing the rest into a count. */
const MAX_VISIBLE = 6;

const LETTER_CLASS: Record<ChangeLetter, string> = {
  A: "text-success",
  M: "text-warning",
  D: "text-destructive",
  U: "text-muted-foreground",
};

interface Row {
  path: string;
  letter: ChangeLetter;
  write?: ChatTurnWrite;
}

/** The write's action as a git letter; the journal is the fresh source before SCM re-walks. */
function letterOf(write: ChatTurnWrite): ChangeLetter {
  switch (write.action) {
    case "create":
      return "A";
    case "delete":
      return "D";
    case "update":
      return "M";
  }
}

/**
 * Staged, unstaged and this turn's writes are one list to the user. The SCM snapshot may
 * still be one walk behind the AI's writes, so the turn journal fills the gap until it
 * catches up; a path appears once.
 */
function rowsOf(repo: RepoState, writes: readonly ChatTurnWrite[]): Row[] {
  const byPath = new Map<string, Row>();
  for (const change of [...repo.staged, ...repo.changes]) {
    if (!byPath.has(change.path))
      byPath.set(change.path, { path: change.path, letter: change.letter });
  }
  for (const write of writes) {
    if (!byPath.has(write.path)) {
      byPath.set(write.path, { path: write.path, letter: letterOf(write), write });
    }
  }
  return [...byPath.values()].toSorted((a, b) => a.path.localeCompare(b.path));
}

export function ChatGitChangesView({
  controller,
  chat,
  state,
}: {
  controller: IdeController;
  chat: ChatSession;
  state: ChatState;
}) {
  const [undoing, setUndoing] = useState(false);
  const scm = useSyncExternalStore(controller.scm.subscribe, controller.scm.getSnapshot);
  const root = controller.activeFolder?.rootPath ?? null;
  const repo = scm.repos.find((entry) => entry.root === root);
  if (repo === undefined || !repo.isRepo) return null;

  const changes = rowsOf(repo, state.writes);
  if (changes.length === 0) return null;
  const visible = changes.slice(0, MAX_VISIBLE);
  const hidden = changes.length - visible.length;
  const canUndo = state.writes.length > 0 && state.phase === "idle";

  async function undo(): Promise<void> {
    setUndoing(true);
    try {
      await chat.gitGate.undo();
    } finally {
      setUndoing(false);
    }
  }

  return (
    <div
      className="border-t bg-card px-2 py-1.5 text-xs"
      aria-label={t("chat.git.title", { n: changes.length })}
    >
      <div className="flex items-center gap-1.5">
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 truncate font-medium">
          {t("chat.git.title", { n: changes.length })}
        </p>
        <Button variant="ghost" size="xs" onClick={() => controller.setActiveView("scm")}>
          {t("chat.git.open")}
        </Button>
        {canUndo && (
          <Button variant="ghost" size="xs" disabled={undoing} onClick={() => void undo()}>
            {undoing ? t("chat.git.undoing") : t("chat.git.undo")}
          </Button>
        )}
      </div>
      <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto font-mono text-[11px]">
        {visible.map((change) => {
          const write = change.write ?? state.writes.find((entry) => entry.path === change.path);
          return (
            <li key={change.path} className="flex items-center gap-1.5">
              <span className={cn("w-3 shrink-0 font-medium", LETTER_CLASS[change.letter])}>
                {change.letter}
              </span>
              <span className="min-w-0 flex-1 truncate" title={change.path}>
                {change.path}
              </span>
              {write !== undefined && (
                <span className="shrink-0 text-[10px]">
                  <span className="text-success">+{write.added}</span>{" "}
                  <span className="text-destructive">-{write.removed}</span>
                </span>
              )}
              {write?.destructive === true && (
                <span
                  className="inline-flex shrink-0 items-center gap-0.5 rounded bg-destructive/10 px-1 text-[9px] font-medium text-destructive"
                  title={t("chat.git.destructiveHint")}
                >
                  <TriangleAlert className="size-2.5" />
                  {t("chat.git.destructive")}
                </span>
              )}
            </li>
          );
        })}
        {hidden > 0 && (
          <li className="text-[10px] text-muted-foreground">{t("chat.git.more", { n: hidden })}</li>
        )}
      </ul>
    </div>
  );
}
