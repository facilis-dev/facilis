import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownEditor } from "./markdown-editor.tsx";

function render(extra: Partial<Parameters<typeof MarkdownEditor>[0]> = {}): string {
  return renderToStaticMarkup(
    <MarkdownEditor value={"# Hello"} onChange={() => undefined} {...extra} />,
  );
}

describe("MarkdownEditor", () => {
  it("renders the write view with a toolbar and tabs", () => {
    const html = render();

    expect(html).toContain('class="fc-markdown-editor"');
    expect(html).toContain("<textarea");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("Write");
    expect(html).toContain("Preview");
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain("# Hello");
    expect(html).toContain('rows="8"');
    expect(html).toContain('placeholder="Write Markdown…"');
  });

  it("exposes every toolbar action with its English label", () => {
    const html = render();
    for (const label of [
      "Bold",
      "Italic",
      "Heading",
      "Bulleted list",
      "Numbered list",
      "Quote",
      "Code",
      "Link",
    ]) {
      expect(html).toContain('aria-label="' + label + '"');
    }
  });

  it("takes custom labels", () => {
    const html = render({
      labels: {
        bold: "Grassetto",
        italic: "Corsivo",
        heading: "Titolo",
        bulletedList: "Elenco",
        numberedList: "Elenco numerato",
        quote: "Citazione",
        code: "Codice",
        link: "Link",
        write: "Scrivi",
        preview: "Anteprima",
      },
    });

    expect(html).toContain('aria-label="Grassetto"');
    expect(html).toContain("Scrivi");
    expect(html).toContain("Anteprima");
  });

  it("forwards Field wiring props to the textarea", () => {
    const html = render({
      id: "body",
      "aria-describedby": "body-hint",
      "aria-invalid": true,
    });

    expect(html).toContain('id="body"');
    expect(html).toContain('aria-describedby="body-hint"');
    expect(html).toContain('aria-invalid="true"');
  });

  it("disables the textarea and the toolbar when disabled", () => {
    const html = render({ disabled: true });

    expect(html).toContain("disabled");
    expect(html).toContain("fc-markdown-editor--disabled");
  });
});
