// The destructive-schema confirmation card (D-193): the turn paused because the write would
// drop a table or a column. "Apply" writes it and records the consent the dev boot needs;
// "Cancel" ends the turn with nothing written. The session clears state.schemaConfirm on
// either choice, which is what unmounts this card.

import TriangleAlert from "~icons/lucide/triangle-alert";
import { Button } from "@/components/ui/button";
import type { ChatSession } from "@/ai/chat-session";
import type { ChatState } from "@/ai/types";
import { t } from "@/i18n";

export function ChatSchemaConfirmView({ chat, state }: { chat: ChatSession; state: ChatState }) {
  const changes = state.schemaConfirm;
  if (changes === null) return null;
  return (
    <div
      className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs"
      aria-label={t("chat.schemaConfirm.title")}
    >
      <div className="flex items-center gap-1.5">
        <TriangleAlert className="size-3.5 shrink-0 text-destructive" />
        <p className="font-medium text-destructive">{t("chat.schemaConfirm.title")}</p>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{t("chat.schemaConfirm.body")}</p>
      <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto rounded border border-border/60 bg-card px-1.5 py-1 font-mono text-[11px]">
        {changes.map((change) => (
          <li key={change} className="truncate" title={change}>
            {change}
          </li>
        ))}
      </ul>
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button variant="destructive" size="sm" onClick={() => chat.schemaConfirm.apply()}>
          {t("chat.schemaConfirm.apply")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => chat.schemaConfirm.cancel()}>
          {t("chat.schemaConfirm.cancel")}
        </Button>
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        {t("chat.schemaConfirm.explanation")}
      </p>
    </div>
  );
}
