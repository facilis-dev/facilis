import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthShell } from "./auth-shell.tsx";

describe("AuthShell", () => {
  it("renders the centred card with title, subtitle, content and footer", () => {
    const html = renderToStaticMarkup(
      <AuthShell
        title="Sign in"
        subtitle="Use your workspace account."
        footer={<span>No account yet?</span>}
        className="extra"
      >
        <form />
      </AuthShell>,
    );

    expect(html).toContain('class="fc-auth extra"');
    expect(html).toContain('<h1 class="fc-auth__title">Sign in</h1>');
    expect(html).toContain('<p class="fc-auth__subtitle">Use your workspace account.</p>');
    expect(html).toContain('<div class="fc-auth__content"><form></form></div>');
    expect(html).toContain('<div class="fc-auth__footer"><span>No account yet?</span></div>');
  });

  it("omits the subtitle and footer when they are not provided", () => {
    const html = renderToStaticMarkup(
      <AuthShell title="Sign in">
        <span>Form</span>
      </AuthShell>,
    );

    expect(html).not.toContain("fc-auth__subtitle");
    expect(html).not.toContain("fc-auth__footer");
    expect(html).toContain("Form");
  });
});
