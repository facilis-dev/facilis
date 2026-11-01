import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Spinner } from "./spinner.tsx";

// Spinner styles are colocated, so the reduced-motion contract is asserted on their own file.
const styles = readFileSync(new URL("./spinner.css", import.meta.url), "utf8");

describe("Spinner", () => {
  it("is decorative when no label is given", () => {
    const html = renderToStaticMarkup(<Spinner />);

    expect(html).toContain('class="fc-spinner"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("role=");
  });

  it("exposes a polite status when labelled", () => {
    const html = renderToStaticMarkup(<Spinner label="Loading todos" />);

    expect(html).toContain('class="fc-spinner"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Loading todos"');
    expect(html).not.toContain("aria-hidden");
  });

  it("stops the animation when the user prefers reduced motion", () => {
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.fc-spinner[^{}]*\{[^}]*animation:\s*none/.test(
        styles,
      ),
    ).toBe(true);
  });
});
