import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Select } from "./select.tsx";

describe("Select", () => {
  it("renders a native select with its children as options", () => {
    const html = renderToStaticMarkup(
      <Select name="locale">
        <option value="en">English</option>
        <option value="it">Italiano</option>
      </Select>,
    );
    expect(html).toContain("<select");
    expect(html).toContain('class="fc-select"');
    expect(html).toContain('name="locale"');
    expect(html).toContain('<option value="en">English</option>');
    expect(html).toContain('<option value="it">Italiano</option>');
  });

  it("appends a custom class after the base class", () => {
    expect(renderToStaticMarkup(<Select className="extra" />)).toContain('class="fc-select extra"');
  });
});
