// The focused status region itself cannot be observed without a DOM: the markup is what
// this test proves, focus movement is a manual/CDP step (pnpm ide:smoke).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BusyStatus } from "./BusyStatus";

describe("BusyStatus", () => {
  it("renders a focusable status region carrying the operation's text", () => {
    const html = renderToStaticMarkup(<BusyStatus>Deleting…</BusyStatus>);
    expect(html).toContain('role="status"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("Deleting…");
  });
});
