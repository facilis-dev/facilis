import { createElement, type ReactNode } from "react";
import { cx } from "./class-names.ts";
import {
  isSafeLink,
  parseInline,
  parseMarkdown,
  type InlineNode,
  type MarkdownBlock,
} from "./markdown-parse.ts";
import "./markdown.css";

export type MarkdownProps = {
  source: string;
  className?: string;
};

function renderInline(nodes: readonly InlineNode[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.value;
      case "break":
        return <br key={index} />;
      case "strong":
        return <strong key={index}>{renderInline(node.children)}</strong>;
      case "em":
        return <em key={index}>{renderInline(node.children)}</em>;
      case "code":
        return (
          <code className="fc-markdown__code" key={index}>
            {node.value}
          </code>
        );
      case "link": {
        const children = renderInline(node.children);
        if (!isSafeLink(node.href)) return <span key={index}>{children}</span>;
        return (
          <a key={index} href={node.href}>
            {children}
          </a>
        );
      }
    }
  });
}

function renderBlock(block: MarkdownBlock, index: number): ReactNode {
  switch (block.type) {
    case "heading": {
      const tag = ("h" + block.level) as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return createElement(
        tag,
        { className: "fc-markdown__heading", key: index },
        renderInline(parseInline(block.content)),
      );
    }
    case "paragraph":
      return <p key={index}>{renderInline(parseInline(block.content))}</p>;
    case "list": {
      const tag = block.ordered ? "ol" : "ul";
      return createElement(
        tag,
        { key: index },
        block.items.map((item, itemIndex) => (
          <li key={itemIndex}>{renderInline(parseInline(item))}</li>
        )),
      );
    }
    case "blockquote":
      return <blockquote key={index}>{renderInline(parseInline(block.content))}</blockquote>;
    case "code":
      return (
        <pre key={index}>
          <code className={block.language === undefined ? undefined : "language-" + block.language}>
            {block.content}
          </code>
        </pre>
      );
    case "hr":
      return <hr key={index} />;
  }
}

/**
 * Safe Markdown renderer: a fixed block/inline subset turned into React elements. Raw HTML is
 * never parsed and nothing is injected with dangerouslySetInnerHTML, so untrusted user content
 * can be previewed as text.
 */
export function Markdown({ source, className }: MarkdownProps) {
  return (
    <div className={cx("fc-markdown", className)}>
      {parseMarkdown(source).map((block, index) => renderBlock(block, index))}
    </div>
  );
}
