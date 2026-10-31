import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button.tsx";

describe("Button", () => {
  it("defaults to the primary variant at medium size and type=button", () => {
    const html = renderToStaticMarkup(<Button>Save</Button>);
    expect(html).toContain('class="fc-btn fc-btn--primary fc-btn--md"');
    expect(html).toContain('type="button"');
    expect(html).toContain("Save");
  });

  it("combines the variant, size and a custom class", () => {
    const html = renderToStaticMarkup(
      <Button variant="danger" size="sm" className="extra">
        Delete
      </Button>,
    );
    expect(html).toContain("fc-btn--danger");
    expect(html).toContain("fc-btn--sm");
    expect(html).toContain("extra");
  });

  it("keeps native button props, including an explicit type", () => {
    const html = renderToStaticMarkup(
      <Button type="submit" name="action" value="go" disabled>
        Go
      </Button>,
    );
    expect(html).toContain('type="submit"');
    expect(html).toContain('name="action"');
    expect(html).toContain('value="go"');
    expect(html).toContain("disabled");
  });
});
