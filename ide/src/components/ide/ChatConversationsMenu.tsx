// The chat's conversations menu (owner report 2026-11-12): several independent chats in one
// sidebar, switchable from the header. The store is in-memory only (chat-store.ts), so the
// titles below are derived from each session's first user message, never persisted.

import { useSyncExternalStore } from "react";
import History from "~icons/lucide/history";
import Check from "~icons/lucide/check";
import Trash2 from "~icons/lucide/trash-2";
import type { ChatSession } from "@/ai/chat-session";
import type { ChatStore } from "@/ai/chat-store";
import type { ChatState } from "@/ai/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";

/** Titles are derived, not stored: the first user message is the conversation's name. */
const TITLE_LIMIT = 48;

function conversationTitle(state: ChatState): string {
  const first = state.messages.find(
    (message) =>
      message.role === "user" &&
      (message.content.length > 0 || (message.images?.length ?? 0) > 0),
  );
  if (first === undefined) return t("chat.conversations.untitled");
  const text =
    first.content.trim().length > 0 ? first.content.trim() : t("chat.conversations.imageOnly");
  return text.length > TITLE_LIMIT ? text.slice(0, TITLE_LIMIT).trimEnd() + "…" : text;
}

// Each entry subscribes to its own session: React Compiler caches the menu's store.list() on
// [store, activeId], so a title derived in the parent would stay "New conversation" after the
// first message until the active id changes (issue #52, same class as the panel switch).
function ConversationItem({
  session,
  active,
  onSelect,
}: {
  session: ChatSession;
  active: boolean;
  onSelect: () => void;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return (
    <DropdownMenuItem
      onClick={onSelect}
      className={active ? "bg-accent text-accent-foreground" : undefined}
    >
      <span className="min-w-0 flex-1 truncate">{conversationTitle(state)}</span>
      {active && <Check className="size-3.5" />}
    </DropdownMenuItem>
  );
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
        {/* Base UI's GroupLabel throws outside a Menu.Group, so the label and the entries
            share one group — without it, opening the menu crashes the IDE (issue #52). */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("chat.conversations.title")}</DropdownMenuLabel>
          {store.list().map(({ id, session }) => (
            <ConversationItem
              key={id}
              session={session}
              active={id === activeId}
              onSelect={() => store.select(id)}
            />
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => store.remove(activeId)}>
          <Trash2 />
          {t("chat.conversations.remove")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
