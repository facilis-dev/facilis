// Assistant prose is Markdown (owner report 2026-11-12). react-markdown compiles it to React
// elements instead of an HTML string, so model output can never inject markup; remark-gfm adds
// the GFM surface (tables, strikethrough, autolinks) without enabling raw HTML. The component
// overrides only restyle elements with the existing role tokens (D-043/D-044): the fenced-code
// panel keeps the look ChatMessageView already had for ``` blocks.

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { cn } from "@/lib/utils";

const CODE_PANEL =
  "mt-1 max-h-64 overflow-auto rounded bg-editor p-1.5 font-mono text-[11px] leading-4 text-editor-foreground";
const HEADING = "mt-2 mb-1 font-semibold text-foreground first:mt-0";
const INLINE_CODE = "rounded bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground";

const components: Components = {
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  p: ({ children }) => <p className="my-1 break-words first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className={cn(HEADING, "text-sm")}>{children}</h1>,
  h2: ({ children }) => <h2 className={cn(HEADING, "text-[13px]")}>{children}</h2>,
  h3: ({ children }) => <h3 className={cn(HEADING, "text-xs")}>{children}</h3>,
  h4: ({ children }) => <h4 className={cn(HEADING, "text-xs")}>{children}</h4>,
  h5: ({ children }) => <h5 className={cn(HEADING, "text-xs")}>{children}</h5>,
  h6: ({ children }) => <h6 className={cn(HEADING, "text-xs")}>{children}</h6>,
  ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-5">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-1 border-l-2 border-border pl-2 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  // A fenced block renders as <pre><code class="language-…">; the descendant resets keep the
  // inline-code look from leaking into the panel (the language class is optional).
  pre: ({ children }) => (
    <pre
      className={cn(
        CODE_PANEL,
        "[&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[11px] [&_code]:leading-4 [&_code]:text-inherit",
      )}
    >
      {children}
    </pre>
  ),
  code: ({ children, className }) => <code className={cn(INLINE_CODE, className)}>{children}</code>,
  table: ({ children }) => (
    <table className="my-2 w-full border-collapse text-left text-[11px]">{children}</table>
  ),
  th: ({ children }) => (
    <th className="border border-border px-1.5 py-1 text-left font-semibold text-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border border-border px-1.5 py-1 align-top">{children}</td>,
  hr: () => <hr className="my-2 border-border" />,
};

/** Renders one assistant message as Markdown; user bubbles stay plain text in ChatMessageView. */
export function ChatMarkdown({ text }: { text: string }) {
  return (
    <div className="min-w-0 break-words">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </Markdown>
    </div>
  );
}
