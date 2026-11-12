// Markdown in the transcript (owner report 2026-11-12). ide/ ships no jsdom or
// testing-library, so the components are rendered to a static string with react-dom/server.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatMessage } from "@/ai/types";
import { ChatMarkdown } from "./ChatMarkdown";
import { ChatMessageView } from "./ChatMessageView";

const markup = (text: string): string => renderToStaticMarkup(<ChatMarkdown text={text} />);

function message(role: ChatMessage["role"], content: string): ChatMessage {
  return { id: "m1", role, content, at: 0 };
}

describe("ChatMarkdown", () => {
  it("renders emphasis, inline code, headings and lists as elements", () => {
    const html = markup(
      "**bold** and *italic* with `inline()`\n\n## Heading\n\n- one\n- two\n\n1. first\n2. second",
    );
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toMatch(/<code[^>]*>inline\(\)<\/code>/);
    expect(html).toContain("<h2");
    expect(html).toContain(">Heading</h2>");
    expect(html).toContain("<ul");
    expect(html).toContain("<ol");
  });

  it("renders a fenced block in the monospace editor panel", () => {
    const html = markup("```ts\nconst answer = 42;\n```");
    expect(html).toMatch(/<pre[^>]*class="[^"]*bg-editor/);
    expect(html).toContain("const answer = 42;");
    expect(html).toContain("language-ts");
  });

  it("renders GFM tables and strikethrough", () => {
    const html = markup("| a | b |\n| --- | --- |\n| 1 | 2 |\n\n~~gone~~");
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("<td");
    expect(html).toContain("<del>gone</del>");
  });

  it("opens links in a new tab without a referrer", () => {
    const html = markup("[Facilis](https://example.com)");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it("never injects raw HTML from model output", () => {
    const html = markup('<script>alert("x")</script>\n\n<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("ChatMessageView", () => {
  it("renders an assistant message as Markdown", () => {
    const html = renderToStaticMarkup(
      <ChatMessageView message={message("assistant", "**bold** and `code`")} />,
    );
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toMatch(/<code[^>]*>code<\/code>/);
  });

  it("keeps a user message as plain text", () => {
    const html = renderToStaticMarkup(
      <ChatMessageView message={message("user", "**not bold**")} />,
    );
    expect(html).not.toContain("<strong>");
    expect(html).not.toContain("<p>");
    expect(html).toContain("**not bold**");
  });
});
