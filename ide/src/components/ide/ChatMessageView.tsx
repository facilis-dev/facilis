// One chat bubble. The model's prose is rendered as text with fenced code blocks
// promoted to a monospace panel; the bubble colours are theme roles, so both themes
// flip without a component change (D-044).

import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/ai/types";

/** Split on triple backticks; odd parts are code, and their first line is the language. */
function MessageContent({ text }: { text: string }) {
  const parts = text.split("```");
  if (parts.length === 1) return <span className="whitespace-pre-wrap break-words">{text}</span>;
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <pre
            key={index}
            className="mt-1 max-h-64 overflow-auto rounded-md bg-editor p-1.5 font-mono text-[11px] leading-4 text-editor-foreground"
          >
            {part.replace(/^[a-zA-Z0-9_+-]+\n/, "")}
          </pre>
        ) : (
          <span key={index} className="whitespace-pre-wrap break-words">
            {part}
          </span>
        ),
      )}
    </>
  );
}

export function ChatMessageView({
  message,
  streaming = false,
}: {
  message: ChatMessage;
  streaming?: boolean;
}) {
  const user = message.role === "user";
  return (
    <div className={cn("flex", user ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[95%] rounded-lg px-2.5 py-2 text-xs",
          user ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        <MessageContent text={message.content} />
        {streaming && (
          <span
            aria-hidden="true"
            className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-current align-text-bottom"
          />
        )}
        {message.detail && (
          <details className="mt-1 text-[10px] opacity-80">
            <summary className="cursor-pointer select-none">{t("chat.detail")}</summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono">
              {message.detail}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
