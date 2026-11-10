// The compacted-context marker (O-018): a quiet transcript row where the summarized history
// ends. Expanding it shows the exact summary the model replays next turn; the covered
// messages themselves stay visible above it. Theme roles only, so both themes flip (D-044).

import FoldVertical from "~icons/lucide/fold-vertical";
import type { ChatSummary } from "@/ai/types";
import { t } from "@/i18n";

export function ChatSummaryView({ summary }: { summary: ChatSummary }) {
  return (
    <details className="rounded-md border border-dashed border-border/60 px-2 py-1 text-[11px] text-muted-foreground">
      <summary className="flex cursor-pointer select-none items-center gap-1.5">
        <FoldVertical className="size-3 shrink-0" />
        <span className="truncate">{t("chat.compact.marker", { n: summary.through })}</span>
      </summary>
      <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-foreground">
        {summary.content}
      </pre>
    </details>
  );
}
