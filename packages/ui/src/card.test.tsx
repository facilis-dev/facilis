import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button.tsx";
import { Card } from "./card.tsx";

describe("Card", () => {
  it("renders the header slots, body and footer", () => {
    const html = renderToStaticMarkup(
      <Card
        title="Projects"
        description="Everything the team owns."
        actions={<Button size="sm">New</Button>}
        footer={<Button variant="ghost">Cancel</Button>}
        className="extra"
      >
        <p>Body</p>
      </Card>,
    );

    expect(html).toContain('class="fc-card extra"');
    expect(html).toContain('<h2 class="fc-card__title">Projects</h2>');
    expect(html).toContain("Everything the team owns.");
    expect(html).toContain('class="fc-card__actions"');
    expect(html).toContain('class="fc-card__body"><p>Body</p></div>');
    expect(html).toContain('class="fc-card__footer"');
  });

  it("omits the header and footer when they are not set, and supports flush", () => {
    const html = renderToStaticMarkup(
      <Card flush>
        <span>Table</span>
      </Card>,
    );

    expect(html).toContain("fc-card--flush");
    expect(html).not.toContain("fc-card__header");
    expect(html).not.toContain("fc-card__footer");
    expect(html).toContain("Table");
  });
});
