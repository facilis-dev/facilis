import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Textarea } from "./textarea.tsx";

describe("Textarea", () => {
  it("renders a native textarea with the base class", () => {
    const html = renderToStaticMarkup(<Textarea name="notes" rows={4} defaultValue="Draft" />);
    expect(html).toContain("<textarea");
    expect(html).toContain('class="fc-textarea"');
    expect(html).toContain('name="notes"');
    expect(html).toContain('rows="4"');
    expect(html).toContain("Draft");
  });

  it("appends a custom class after the base class", () => {
    expect(renderToStaticMarkup(<Textarea className="extra" />)).toContain(
      'class="fc-textarea extra"',
    );
  });
});
