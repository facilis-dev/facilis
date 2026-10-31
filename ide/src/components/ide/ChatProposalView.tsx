// The reviewable patch card (D-046): per-file diff, per-file accept, one Apply.
//
// Nothing here writes: the card is a view over ChatSession's proposal, and Apply
// goes through ChatSession.apply() -> applyPatch(), which validates first (SPEC §9.3).

import { useState } from "react";
import ChevronDown from "~icons/lucide/chevron-down";
import ChevronRight from "~icons/lucide/chevron-right";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ChatSession } from "@/ai/chat-session";
import type { ChatState, DiffLine } from "@/ai/types";

const PREFIX: Record<DiffLine["kind"], string> = { add: "+", del: "-", ctx: " ", hunk: "" };
const LINE_CLASS: Record<DiffLine["kind"], string> = {
  add: "text-success",
  del: "text-destructive",
  ctx: "text-editor-foreground",
  hunk: "text-muted-foreground",
};

export function ChatProposalView({ chat, state }: { chat: ChatSession; state: ChatState }) {
  return (
    <>
      {state.applied && <AppliedCard chat={chat} state={state} />}
      {state.proposal && <ProposalCard chat={chat} state={state} />}
    </>
  );
}

function AppliedCard({ chat, state }: { chat: ChatSession; state: ChatState }) {
  const applied = state.applied;
  if (!applied) return null;
  const paths = [...applied.written, ...applied.deleted];
  return (
    <div className="rounded-md border bg-card p-2 text-xs">
      <p className={cn("font-medium", applied.ok ? "text-success" : "text-destructive")}>
        {applied.ok ? t("chat.proposal.applied", { n: paths.length }) : t("chat.proposal.failed")}
      </p>
      <ul className="mt-1 space-y-0.5">
        {paths.map((path) => (
          <li key={path}>
            <button
              type="button"
              className="max-w-full truncate font-mono text-[11px] underline underline-offset-2"
              title={t("chat.proposal.openFile", { path })}
              onClick={() => chat.openFile(path)}
            >
              {path}
            </button>
          </li>
        ))}
      </ul>
      {applied.errors.length > 0 && (
        <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] text-destructive">
          {applied.errors.join("\n")}
        </pre>
      )}
    </div>
  );
}

function ProposalCard({ chat, state }: { chat: ChatSession; state: ChatState }) {
  const proposal = state.proposal;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  if (!proposal) return null;
  const accepted = proposal.files.filter((file) => file.accepted).length;
  const busy = state.phase !== "idle";
  const toggle = (path: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div className="rounded-md border bg-card p-2 text-xs">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{t("chat.proposal.title")}</p>
        <Button variant="ghost" size="xs" disabled={busy} onClick={() => chat.discard()}>
          {t("chat.proposal.discard")}
        </Button>
      </div>
      {proposal.requiresConfirmation && (
        <p className="mt-1 rounded border border-warning px-1.5 py-1 text-[11px] text-warning">
          {t("chat.proposal.confirm")}
        </p>
      )}
      {proposal.notes.length > 0 && (
        <div className="mt-1">
          <p className="text-[10px] text-muted-foreground">{t("chat.proposal.notes")}</p>
          <ul className="list-disc pl-4 text-[11px]">
            {proposal.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
      <ul className="mt-1 space-y-1">
        {proposal.files.map((file) => {
          const path = file.patch.path;
          const open = expanded.has(path);
          return (
            <li key={path} className="rounded border">
              <div className="flex items-center gap-1.5 px-1.5 py-1">
                <input
                  type="checkbox"
                  className="size-3 accent-primary"
                  checked={file.accepted}
                  disabled={busy}
                  aria-label={path}
                  onChange={() => chat.toggleFile(path)}
                />
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1 text-left"
                  aria-expanded={open}
                  onClick={() => toggle(path)}
                >
                  {open ? (
                    <ChevronDown className="size-3 shrink-0" />
                  ) : (
                    <ChevronRight className="size-3 shrink-0" />
                  )}
                  <span className="truncate font-mono text-[11px]">{path}</span>
                  <span className="ml-auto shrink-0 text-[10px]">
                    <span className="text-success">+{file.added}</span>{" "}
                    <span className="text-destructive">-{file.removed}</span>
                  </span>
                </button>
              </div>
              {open &&
                (file.diff.length === 0 ? (
                  <p className="border-t px-2 py-1 text-[10px] text-muted-foreground">
                    {t("chat.proposal.noChanges")}
                  </p>
                ) : (
                  <pre className="max-h-56 overflow-auto border-t px-1.5 py-1 font-mono text-[10px] leading-4">
                    {file.diff.map((line, index) => (
                      <div key={index} className={LINE_CLASS[line.kind]}>
                        {PREFIX[line.kind] + line.text}
                      </div>
                    ))}
                  </pre>
                ))}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex justify-end">
        <Button size="sm" disabled={accepted === 0 || busy} onClick={() => void chat.apply()}>
          {state.phase === "applying"
            ? t("chat.applying")
            : accepted === proposal.files.length
              ? t("chat.proposal.applyAll")
              : t("chat.proposal.apply", { n: accepted })}
        </Button>
      </div>
    </div>
  );
}
