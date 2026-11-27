// The declared-capability confirmation card (D-226, #234): the turn paused because a write adds
// a non-standard capability. Each row shows the capability, the exact site, the source snippet
// and an editable reason prefilled with the one the model generated; "Confirm" writes the patch
// with the user's wording, "Cancel" drops it and the turn continues.
//
// The session clears state.surfaceConfirm on either choice, which is what unmounts this card.

import ShieldAlert from "~icons/lucide/shield-alert";
import { useState } from "react";
import type { SurfaceRequest } from "@facilis.dev/ai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChatSession } from "@/ai/chat-session";
import type { ChatState } from "@/ai/types";
import { surfaceRequestKey } from "@/ai/surface-reason";
import { t, type MessageKey } from "@/i18n";

const CAPABILITY_KEYS: Record<SurfaceRequest["capability"], MessageKey> = {
  "raw-route": "chat.surfaceConfirm.capability.rawRoute",
  "server-extension": "chat.surfaceConfirm.capability.serverExtension",
  "raw-sql": "chat.surfaceConfirm.capability.rawSql",
  "raw-db": "chat.surfaceConfirm.capability.rawDb",
  "dynamic-code": "chat.surfaceConfirm.capability.dynamicCode",
};

export function ChatSurfaceConfirmView({ chat, state }: { chat: ChatSession; state: ChatState }) {
  const [edited, setEdited] = useState<Record<string, string>>({});
  const requests = state.surfaceConfirm;
  if (requests === null) return null;
  return (
    <div
      data-testid="chat-surface-confirm"
      className="rounded-md border border-warning/40 bg-warning/5 p-2 text-xs"
      aria-label={t("chat.surfaceConfirm.title")}
    >
      <div className="flex items-center gap-1.5">
        <ShieldAlert className="size-3.5 shrink-0 text-warning" />
        <p className="font-medium text-warning">{t("chat.surfaceConfirm.title")}</p>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{t("chat.surfaceConfirm.body")}</p>
      <ul className="mt-1 max-h-56 space-y-1.5 overflow-y-auto">
        {requests.map((request) => {
          const key = surfaceRequestKey(request);
          return (
            <li key={key} className="rounded border border-border/60 bg-card px-1.5 py-1">
              <div className="flex items-center gap-1.5">
                <span className="shrink-0 rounded border border-warning/50 px-1 py-0.5 text-[10px] font-medium text-warning">
                  {t(CAPABILITY_KEYS[request.capability])}
                </span>
                <span
                  className="truncate font-mono text-[10px] text-muted-foreground"
                  title={request.path}
                >
                  {request.path}:{request.line}
                </span>
              </div>
              <pre className="mt-1 max-h-20 overflow-auto whitespace-pre-wrap break-words rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">
                {request.snippet}
              </pre>
              <label className="mt-1 block text-[10px] text-muted-foreground">
                {t("chat.surfaceConfirm.reason")}
                <Input
                  className="mt-0.5 h-6 font-mono text-[11px]"
                  value={edited[key] ?? request.reason}
                  aria-label={t("chat.surfaceConfirm.reason")}
                  onChange={(event) =>
                    setEdited((current) => ({ ...current, [key]: event.target.value }))
                  }
                />
              </label>
            </li>
          );
        })}
      </ul>
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button size="sm" onClick={() => chat.surfaceConfirm.confirm(edited)}>
          {t("chat.surfaceConfirm.confirm")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => chat.surfaceConfirm.cancel()}>
          {t("chat.surfaceConfirm.cancel")}
        </Button>
      </div>
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        {t("chat.surfaceConfirm.explanation")}
      </p>
    </div>
  );
}
