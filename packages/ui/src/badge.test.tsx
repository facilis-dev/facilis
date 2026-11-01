import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge.tsx";

describe("Badge", () => {
  it("defaults to the neutral tone", () => {
    const html = renderToStaticMarkup(<Badge>Draft</Badge>);
    expect(html).toContain('class="fc-badge fc-badge--neutral"');
    expect(html).toContain("Draft");
  });

  it("selects the tone class and keeps span props", () => {
    const html = renderToStaticMarkup(
      <Badge tone="warning" title="Needs review">
        Review
      </Badge>,
    );
    expect(html).toContain("fc-badge--warning");
    expect(html).toContain('title="Needs review"');
  });
});
