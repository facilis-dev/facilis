import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Switch } from "./switch.tsx";

describe("Switch", () => {
  it("exposes role=switch with the checked state", () => {
    const on = renderToStaticMarkup(
      <Switch checked onChange={() => undefined} label="Email notifications" />,
    );
    const off = renderToStaticMarkup(
      <Switch checked={false} onChange={() => undefined} label="Email notifications" />,
    );

    expect(on).toContain('role="switch"');
    expect(on).toContain('aria-checked="true"');
    expect(off).toContain('aria-checked="false"');
    expect(on).toContain('aria-label="Email notifications"');
    expect(on).toContain('class="fc-switch"');
  });

  it("forwards the disabled state", () => {
    const html = renderToStaticMarkup(
      <Switch checked={false} onChange={() => undefined} label="Locked" disabled />,
    );
    expect(html).toContain("disabled");
  });
});
