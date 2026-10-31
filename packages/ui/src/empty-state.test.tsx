import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button.tsx";
import { EmptyState } from "./empty-state.tsx";

describe("EmptyState", () => {
  it("renders the title, description, action and a custom class", () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="No todos yet"
        description="Create your first todo to see it here."
        action={<Button size="sm">Create todo</Button>}
        className="extra"
      />,
    );

    expect(html).toContain('class="fc-empty extra"');
    expect(html).toContain('<p class="fc-empty__title">No todos yet</p>');
    expect(html).toContain(
      '<p class="fc-empty__description">Create your first todo to see it here.</p>',
    );
    expect(html).toContain('class="fc-empty__action"');
    expect(html).toContain("Create todo");
  });

  it("omits the description and action when they are not provided", () => {
    const html = renderToStaticMarkup(<EmptyState title="Nothing here" />);

    expect(html).not.toContain("fc-empty__description");
    expect(html).not.toContain("fc-empty__action");
    expect(html).toContain("Nothing here");
  });
});
