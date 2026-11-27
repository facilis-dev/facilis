// Static-markup assertions for a rendered markdown cell (issue #221). Whether focus
// actually lands on it and moves into the editor needs a browser and stays a
// pnpm ide:smoke step; the attributes a screen reader reads do not.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@/i18n";
import { en } from "@/i18n/en";
import { newCell } from "@/vv/notebook/ipynb.js";
import { MarkdownCell } from "./NotebookMarkdownCell";
import { NotebookFocus } from "./notebook-focus";

beforeEach(() => {
  initI18n();
  setLocale("en");
});

function render(source: string, index = 1, total = 4): string {
  return renderToStaticMarkup(
    <MarkdownCell
      cell={newCell("markdown", source)}
      index={index}
      total={total}
      focus={new NotebookFocus()}
      onEdit={() => {}}
    />,
  );
}

describe("MarkdownCell", () => {
  it("is a named, focusable group with an explicit edit button", () => {
    const html = render("**bold**", 1, 4);
    expect(html).toContain('role="group"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Markdown cell 2 of 4. Enter to edit"');
    expect(html).toContain("<button");
    expect(html).toContain('aria-label="Edit markdown cell 2 of 4"');
  });

  it("renders the cell's markdown", () => {
    expect(render("**bold**")).toContain("<strong>bold</strong>");
  });

  it("says an empty cell is empty", () => {
    expect(render("")).toContain(en["notebook.emptyMarkdown"]);
  });
});
