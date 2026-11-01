import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown.tsx";

function render(source: string): string {
  return renderToStaticMarkup(<Markdown source={source} />);
}

describe("Markdown", () => {
  it("renders headings, paragraphs and inline styles", () => {
    const tick = String.fromCharCode(96);
    const html = render("## Title\n\nHello **bold**, *italic* and " + tick + "code" + tick + ".");

    expect(html).toContain('<h2 class="fc-markdown__heading">Title</h2>');
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain('<code class="fc-markdown__code">code</code>');
    expect(html).toContain("<p>Hello");
  });

  it("renders lists, quotes, code fences and rules", () => {
    const fence = String.fromCharCode(96).repeat(3);
    const html = render(
      "- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n---\n\n" +
        fence +
        "ts\nconst answer = 42;\n" +
        fence,
    );

    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<ol><li>first</li><li>second</li></ol>");
    expect(html).toContain("<blockquote>quoted</blockquote>");
    expect(html).toContain("<hr/>");
    expect(html).toContain('<code class="language-ts">const answer = 42;</code>');
  });

  it("renders safe links and rejects unsafe schemes", () => {
    const safe = render("[docs](https://example.com)");
    expect(safe).toContain('<a href="https://example.com">docs</a>');

    const unsafe = render("[click](javascript:void)");
    expect(unsafe).not.toContain("<a ");
    expect(unsafe).toContain("click");

    expect(render("[mail](mailto:hi@example.com)")).toContain('<a href="mailto:hi@example.com">');
    expect(render("[top](#section)")).toContain('<a href="#section">');
  });

  it("keeps raw HTML as text", () => {
    const html = render("<b>hi</b> and <script>alert(1)</script>");

    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(html).not.toContain("<b>");
    expect(html).not.toContain("<script>");
  });

  it("turns single newlines into line breaks and nests emphasis", () => {
    const html = render("line one\nline two\n\n**outer *inner* text**");

    expect(html).toContain("<br/>");
    expect(html).toContain("<strong>outer <em>inner</em> text</strong>");
  });

  it("passes a custom class through", () => {
    expect(renderToStaticMarkup(<Markdown source="text" className="extra" />)).toContain(
      'class="fc-markdown extra"',
    );
  });
});
