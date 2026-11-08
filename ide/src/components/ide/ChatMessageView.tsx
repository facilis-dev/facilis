// One transcript entry (D-114/CHAT-UX): the assistant's prose is a plain block, the user's
// message a quiet bubble on the right; pasted images sit above the text (D-113) and fenced code
// blocks become a monospace panel. Theme roles only, so both themes flip without a component
// change (D-044).

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
            className="mt-1 max-h-64 overflow-auto rounded bg-editor p-1.5 font-mono text-[11px] leading-4 text-editor-foreground"
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
          "text-xs text-foreground",
          user ? "max-w-[95%] rounded-lg bg-muted/70 px-2.5 py-1.5" : "w-full leading-relaxed",
        )}
      >
        {message.images !== undefined && message.images.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-1">
            {message.images.map((src, index) => (
              <a key={index} href={src} target="_blank" rel="noreferrer">
                <img
                  src={src}
                  alt={t("chat.image.pending", { n: index + 1 })}
                  className="max-h-40 rounded border border-border/60"
                />
              </a>
            ))}
          </div>
        )}
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
