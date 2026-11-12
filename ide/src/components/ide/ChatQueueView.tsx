// The pending-message queue above the composer (owner report 2026-11-12): messages typed
// while the assistant is busy wait here, each removable before it starts. The session sends
// them FIFO as soon as it returns to idle, so this view only renders ChatState.queued.

import X from "~icons/lucide/x";
import { Button } from "@/components/ui/button";
import type { ChatSession } from "@/ai/chat-session";
import type { ChatState } from "@/ai/types";
import { t } from "@/i18n";

export function ChatQueueView({ chat, state }: { chat: ChatSession; state: ChatState }) {
  if (state.queued.length === 0) return null;
  return (
    <div className="border-t px-2 py-1.5" aria-label={t("chat.queue.title")}>
      <p className="mb-1 text-[10px] font-medium text-muted-foreground">{t("chat.queue.title")}</p>
      <ul className="space-y-1">
        {state.queued.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-1 rounded border border-border/60 bg-muted/30 px-1.5 py-1"
          >
            <span className="min-w-0 flex-1 truncate text-[11px]" title={item.text}>
              {item.text || t("chat.queue.imageOnly")}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-5 shrink-0"
              aria-label={t("chat.queue.remove")}
              title={t("chat.queue.remove")}
              onClick={() => chat.removeQueued(item.id)}
            >
              <X />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
