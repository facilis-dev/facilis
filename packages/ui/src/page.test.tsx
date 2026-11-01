import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button.tsx";
import { Page } from "./page.tsx";

describe("Page", () => {
  it("renders the title, description, actions and content", () => {
    const html = renderToStaticMarkup(
      <Page
        title="Todos"
        description="Everything due today."
        actions={<Button size="sm">New todo</Button>}
        className="extra"
      >
        <p>Body</p>
      </Page>,
    );

    expect(html).toContain('class="fc-page extra"');
    expect(html).toContain('<h1 class="fc-page__title">Todos</h1>');
    expect(html).toContain('<p class="fc-page__description">Everything due today.</p>');
    expect(html).toContain('class="fc-page__actions"');
    expect(html).toContain("New todo");
    expect(html).toContain('<div class="fc-page__content">');
    expect(html).toContain("<p>Body</p>");
  });

  it("omits the description and actions when they are not provided", () => {
    const html = renderToStaticMarkup(<Page title="Todos">Body</Page>);

    expect(html).not.toContain("fc-page__description");
    expect(html).not.toContain("fc-page__actions");
    expect(html).toContain("Body");
  });
});
