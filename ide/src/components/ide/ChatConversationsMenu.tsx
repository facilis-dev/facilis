// The chat's conversations menu (owner report 2026-11-12): several independent chats in one
// sidebar, switchable from the header. The store is in-memory only (chat-store.ts), so the
// titles below are derived from each session's first user message, never persisted.

import History from "~icons/lucide/history";
import Check from "~icons/lucide/check";
import Trash2 from "~icons/lucide/trash-2";
import type { ChatSession } from "@/ai/chat-session";
import type { ChatStore } from "@/ai/chat-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";

/** Titles are derived, not stored: the first user message is the conversation's name. */
const TITLE_LIMIT = 48;

function conversationTitle(session: ChatSession): string {
  const first = session
    .getSnapshot()
    .messages.find(
      (message) =>
        message.role === "user" &&
        (message.content.length > 0 || (message.images?.length ?? 0) > 0),
    );
  if (first === undefined) return t("chat.conversations.untitled");
  const text =
    first.content.trim().length > 0 ? first.content.trim() : t("chat.conversations.imageOnly");
  return text.length > TITLE_LIMIT ? text.slice(0, TITLE_LIMIT).trimEnd() + "…" : text;
}

export function ChatConversationsMenu({ store, activeId }: { store: ChatStore; activeId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-[min(var(--radius-md),12px)] transition-colors hover:bg-accent aria-expanded:bg-accent"
        aria-label={t("chat.conversations.menu")}
        title={t("chat.conversations.menu")}
      >
        <History className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{t("chat.conversations.title")}</DropdownMenuLabel>
        {store.list().map(({ id, session }) => (
          <DropdownMenuItem
            key={id}
            onClick={() => store.select(id)}
            className={id === activeId ? "bg-accent text-accent-foreground" : undefined}
          >
            <span className="min-w-0 flex-1 truncate">{conversationTitle(session)}</span>
            {id === activeId && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => store.remove(activeId)}>
          <Trash2 />
          {t("chat.conversations.remove")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
