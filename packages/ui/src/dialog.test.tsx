import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Dialog } from "./dialog.tsx";

describe("Dialog", () => {
  it("renders nothing while closed", () => {
    expect(
      renderToStaticMarkup(
        <Dialog open={false} onClose={() => undefined} title="Delete project?">
          Body
        </Dialog>,
      ),
    ).toBe("");
  });

  it("renders an accessible modal with title, description, body and footer", () => {
    const html = renderToStaticMarkup(
      <Dialog
        open
        onClose={() => undefined}
        title="Delete project?"
        description="This cannot be undone."
        footer={<button type="button">Delete</button>}
      >
        <p>Members keep their other projects.</p>
      </Dialog>,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("aria-labelledby");
    expect(html).toContain("aria-describedby");
    expect(html).toContain('<h2 class="fc-dialog__title"');
    expect(html).toContain("Delete project?");
    expect(html).toContain("This cannot be undone.");
    expect(html).toContain('class="fc-dialog__body"');
    expect(html).toContain('class="fc-dialog__footer"');
    expect(html).toContain('aria-label="Close"');
  });

  it("takes a custom close label", () => {
    const html = renderToStaticMarkup(
      <Dialog open onClose={() => undefined} title="Invite" closeLabel="Chiudi">
        Body
      </Dialog>,
    );
    expect(html).toContain('aria-label="Chiudi"');
  });
});
