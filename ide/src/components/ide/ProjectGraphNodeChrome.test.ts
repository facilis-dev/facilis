// The card frame's channel contract (issue #66): the user focus dims to 12%, edge isolation
// to 10%, a search miss to 40% — the strongest dim wins — and the AI focus outlines in the
// brand role without dimming. Both channels can sit on one card (criterion 5).
import { describe, expect, it } from "vitest";
import { nodeClass } from "./ProjectGraphNodeChrome";

// selected, matched, dragging, focused (user closure), isolated (edge kinds), aiOutlined.
const frame = (
  overrides: Partial<{
    selected: boolean;
    matched: boolean;
    dragging: boolean;
    focused: boolean;
    isolated: boolean;
    aiOutlined: boolean;
  }> = {},
): string =>
  nodeClass(
    overrides.selected ?? false,
    overrides.matched ?? true,
    overrides.dragging ?? false,
    overrides.focused ?? true,
    overrides.isolated ?? false,
    overrides.aiOutlined ?? false,
  );

describe("nodeClass channels", () => {
  it("draws a plain card with no dim and no outline", () => {
    const cls = frame();
    expect(cls).not.toContain("opacity-");
    expect(cls).not.toContain("outline");
  });

  it("dims a card outside the user's closure to 12%", () => {
    expect(frame({ focused: false })).toContain("opacity-12");
  });

  it("outlines an AI-named card in the brand role without dimming it", () => {
    const cls = frame({ aiOutlined: true });
    expect(cls).toContain("outline-2");
    expect(cls).toContain("outline-brand/70");
    expect(cls).not.toContain("opacity-");
  });

  it("composes: a dimmed card can still carry the AI outline", () => {
    const cls = frame({ focused: false, aiOutlined: true });
    expect(cls).toContain("opacity-12");
    expect(cls).toContain("outline-brand/70");
  });

  it("lets edge isolation (10%) win over the user dim (12%)", () => {
    const cls = frame({ focused: false, isolated: true });
    expect(cls).toContain("opacity-10");
    expect(cls).not.toContain("opacity-12");
  });

  it("keeps the search-miss dim at 40% and lets the stronger user dim win", () => {
    expect(frame({ matched: false })).toContain("opacity-40");
    expect(frame({ matched: false, focused: false })).toContain("opacity-12");
  });

  it("dims an impact outsider to 12% and lets the stronger isolation dim win (issue #74)", () => {
    expect(nodeClass(false, true, false, true, false, false, true)).toContain("opacity-12");
    expect(nodeClass(false, true, false, true, true, false, true)).toContain("opacity-10");
    // A search miss (40%) recedes further than the impact dim, like the user focus.
    expect(nodeClass(false, false, false, true, false, false, true)).toContain("opacity-12");
    expect(nodeClass(false, true, false, true, false, false, false)).not.toContain("opacity-");
  });

  it("keeps the selection ring under both channels", () => {
    const cls = frame({ selected: true, focused: false, aiOutlined: true });
    expect(cls).toContain("ring-primary");
    expect(cls).toContain("opacity-12");
    expect(cls).toContain("outline-brand/70");
  });
});
