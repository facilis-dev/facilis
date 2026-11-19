// The git-changes summary under the conversation (D-192). The chat no longer ends on a
// proposal card: the assistant writes the files, and the work lands outside the transcript,
// in a persistent footer at the bottom of the panel. It shows the working tree as Source
// Control sees it (staged and unstaged), so the user can review what changed without
// scrolling the conversation, undo the AI's turn, or jump to the Source Control panel.
//
// Store-driven: the SCM session is the source of truth (a discard or commit elsewhere updates
// this footer too). Rows are listed rather than opened: the transcript already links files.
//
// The header is a disclosure control: expanded is the default because a turn that touched
// files is exactly why the footer appears; collapsing reclaims the transcript's height once
// the work has been reviewed.

import { useState, useSyncExternalStore } from "react";
import ChevronDown from "~icons/lucide/chevron-down";
import GitBranch from "~icons/lucide/git-branch";
import TriangleAlert from "~icons/lucide/triangle-alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ChatSession } from "@/ai/chat-session";
import type { ChatState, ChatTurnWrite } from "@/ai/types";
import type { IdeController } from "@/vv/controller";
import type { ChangeLetter, RepoState } from "@/vv/scm-session";
import { t } from "@/i18n";

const LIST_ID = "chat-git-changes-list";

const LETTER_CLASS: Record<ChangeLetter, string> = {
  A: "text-success",
  M: "text-warning",
  D: "text-destructive",
  U: "text-muted-foreground",
};

export interface ChatGitChangeRow {
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
 * catches up; a path appears once, keeping the SCM letter but borrowing the journal's lines.
 */
function rowsOf(repo: RepoState, writes: readonly ChatTurnWrite[]): ChatGitChangeRow[] {
  const byPath = new Map<string, ChatGitChangeRow>();
  for (const change of [...repo.staged, ...repo.changes]) {
    if (!byPath.has(change.path))
      byPath.set(change.path, { path: change.path, letter: change.letter });
  }
  for (const write of writes) {
    const existing = byPath.get(write.path);
    if (existing === undefined) {
      byPath.set(write.path, { path: write.path, letter: letterOf(write), write });
    } else if (existing.write === undefined) {
      existing.write = write;
    }
  }
  return [...byPath.values()].toSorted((a, b) => a.path.localeCompare(b.path));
}

/**
 * Presentational half: the store-driven container below owns undo and expansion, this renders
 * a given state so the markup can be tested without the IDE context (the IDE ships no jsdom).
 */
export function ChatGitChangesFooterView({
  changes,
  expanded,
  canUndo,
  undoing,
  onToggle,
  onOpenScm,
  onUndo,
}: {
  changes: readonly ChatGitChangeRow[];
  expanded: boolean;
  canUndo: boolean;
  undoing: boolean;
  onToggle: () => void;
  onOpenScm: () => void;
  onUndo: () => void;
}) {
  const title = t("chat.git.title", { n: changes.length });
  const toggleLabel = expanded ? t("chat.git.collapse") : t("chat.git.expand");
  // A destructive write must stay visible even when its row is collapsed away.
  const destructive = changes.some((change) => change.write?.destructive === true);

  return (
    <div className="border-t bg-card px-2 py-1.5 text-xs" aria-label={title}>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
          aria-controls={LIST_ID}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={onToggle}
        >
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
          {!expanded && destructive && (
            <span
              role="img"
              className="text-destructive"
              aria-label={t("chat.git.destructive")}
              title={t("chat.git.destructiveHint")}
            >
              <TriangleAlert className="size-3.5 shrink-0" />
            </span>
          )}
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              !expanded && "-rotate-90",
            )}
          />
        </button>
        <Button variant="ghost" size="xs" onClick={onOpenScm}>
          {t("chat.git.open")}
        </Button>
        {canUndo && (
          <Button variant="ghost" size="xs" disabled={undoing} onClick={onUndo}>
            {undoing ? t("chat.git.undoing") : t("chat.git.undo")}
          </Button>
        )}
      </div>
      <ul
        id={LIST_ID}
        hidden={!expanded}
        className="mt-1 max-h-[min(40vh,16rem)] space-y-0.5 overflow-y-auto font-mono text-[11px]"
      >
        {changes.map((change) => (
          <li key={change.path} className="flex items-center gap-1.5">
            <span className={cn("w-3 shrink-0 font-medium", LETTER_CLASS[change.letter])}>
              {change.letter}
            </span>
            <span className="min-w-0 flex-1 truncate" title={change.path}>
              {change.path}
            </span>
            {change.write !== undefined && (
              <span className="shrink-0 text-[10px]">
                <span className="text-success">+{change.write.added}</span>{" "}
                <span className="text-destructive">-{change.write.removed}</span>
              </span>
            )}
            {change.write?.destructive === true && (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 rounded bg-destructive/10 px-1 text-[9px] font-medium text-destructive"
                title={t("chat.git.destructiveHint")}
              >
                <TriangleAlert className="size-2.5" />
                {t("chat.git.destructive")}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
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
  const [expanded, setExpanded] = useState(true);
  const scm = useSyncExternalStore(controller.scm.subscribe, controller.scm.getSnapshot);
  const root = controller.activeFolder?.rootPath ?? null;
  const repo = scm.repos.find((entry) => entry.root === root);
  if (repo === undefined || !repo.isRepo) return null;

  const changes = rowsOf(repo, state.writes);
  if (changes.length === 0) return null;
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
    <ChatGitChangesFooterView
      changes={changes}
      expanded={expanded}
      canUndo={canUndo}
      undoing={undoing}
      onToggle={() => setExpanded((open) => !open)}
      onOpenScm={() => controller.setActiveView("scm")}
      onUndo={() => void undo()}
    />
  );
}
