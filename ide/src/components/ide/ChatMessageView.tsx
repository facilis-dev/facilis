// One transcript entry (D-114/CHAT-UX): the assistant's prose is Markdown, the user's message a
// quiet plain-text bubble on the right (a user's literal text must not turn into markup); pasted
// images sit above it (D-113). Theme roles only, so both themes flip without a component change
// (D-044).

import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/ai/types";
import { ChatMarkdown } from "./ChatMarkdown";

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
        {user ? (
          <span className="whitespace-pre-wrap break-words">{message.content}</span>
        ) : (
          <ChatMarkdown text={message.content} />
        )}
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
