import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Skeleton } from "./skeleton.tsx";

describe("Skeleton", () => {
  it("renders a decorative block with the given size", () => {
    const html = renderToStaticMarkup(<Skeleton width="12rem" height="1rem" />);

    expect(html).toContain('class="fc-skeleton"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("width:12rem");
    expect(html).toContain("height:1rem");
    expect(html).not.toContain("fc-skeleton--circle");
  });

  it("supports the circle variant and custom classes", () => {
    const html = renderToStaticMarkup(<Skeleton circle className="extra" />);

    expect(html).toContain("fc-skeleton--circle");
    expect(html).toContain("extra");
  });
});
