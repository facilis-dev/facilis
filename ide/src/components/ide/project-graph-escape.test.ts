// Escape-ladder regression tests (issues #187/#188): one press does one thing, and the rich
// card closes before the drawer without swallowing the rest of the ladder.

import { describe, expect, it } from "vitest";
import { resolveEscapeAction, type EscapeLadderState } from "./project-graph-escape.ts";

const BASE: EscapeLadderState = {
  fullscreen: false,
  typing: false,
  focusActive: false,
  richCardOpen: false,
  drawerOpen: false,
  selectedNodeId: null,
  detail: false,
};

describe("resolveEscapeAction", () => {
  it("keeps the existing ladder order", () => {
    expect(resolveEscapeAction({ ...BASE, fullscreen: true })).toBe("exit-fullscreen");
    expect(resolveEscapeAction({ ...BASE, focusActive: true })).toBe("clear-focus");
    expect(resolveEscapeAction({ ...BASE, drawerOpen: true })).toBe("close-drawer");
    expect(resolveEscapeAction({ ...BASE, selectedNodeId: "table:todos" })).toBe("clear-selection");
    expect(resolveEscapeAction({ ...BASE, detail: true })).toBe("overview");
    expect(resolveEscapeAction(BASE)).toBe("none");
  });

  it("closes the rich card before the drawer and selection", () => {
    expect(
      resolveEscapeAction({
        ...BASE,
        richCardOpen: true,
        drawerOpen: true,
        selectedNodeId: "table:todos",
      }),
    ).toBe("close-rich-card");
  });

  it("does not steal Escape from a typing target unless fullscreen is the only way out", () => {
    expect(resolveEscapeAction({ ...BASE, typing: true, drawerOpen: true })).toBe("ignore");
    expect(resolveEscapeAction({ ...BASE, typing: true, fullscreen: true })).toBe(
      "exit-fullscreen",
    );
  });
});
