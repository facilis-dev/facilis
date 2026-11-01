import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Input } from "./input.tsx";

describe("Input", () => {
  it("renders a native input with the base class and its props", () => {
    const html = renderToStaticMarkup(<Input name="email" placeholder="you@example.com" />);
    expect(html).toContain("<input");
    expect(html).toContain('class="fc-input"');
    expect(html).toContain('name="email"');
    expect(html).toContain('placeholder="you@example.com"');
  });

  it("appends a custom class after the base class", () => {
    expect(renderToStaticMarkup(<Input className="extra" />)).toContain('class="fc-input extra"');
  });
});
