import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Checkbox } from "./checkbox.tsx";

describe("Checkbox", () => {
  it("always renders type=checkbox with the base class", () => {
    const html = renderToStaticMarkup(<Checkbox name="terms" defaultChecked />);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('class="fc-checkbox"');
    expect(html).toContain('name="terms"');
    expect(html).toContain("checked");
  });

  it("appends a custom class after the base class", () => {
    expect(renderToStaticMarkup(<Checkbox className="extra" />)).toContain(
      'class="fc-checkbox extra"',
    );
  });
});
