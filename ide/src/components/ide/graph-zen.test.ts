import { describe, expect, it } from "vitest";
import { resolveGraphEscape } from "./graph-zen";

const base = {
  zen: false,
  inspectorOpen: false,
  focusActive: false,
  typing: false,
  defaultPrevented: false,
};

describe("resolveGraphEscape", () => {
  it("does nothing when no mode is active", () => {
    expect(resolveGraphEscape(base)).toBeNull();
  });

  it("exits zen first, even with an inspector and a focus underneath", () => {
    expect(resolveGraphEscape({ ...base, zen: true, inspectorOpen: true, focusActive: true })).toBe(
      "exit-zen",
    );
  });

  it("closes the inspector before clearing an AI focus", () => {
    expect(resolveGraphEscape({ ...base, inspectorOpen: true, focusActive: true })).toBe(
      "close-inspector",
    );
  });

  it("clears the focus when nothing else is open (D-171)", () => {
    expect(resolveGraphEscape({ ...base, focusActive: true })).toBe("clear-focus");
  });

  it("never steals Escape from a typing target (search, note editor)", () => {
    expect(resolveGraphEscape({ ...base, zen: true, typing: true })).toBeNull();
    expect(resolveGraphEscape({ ...base, inspectorOpen: true, typing: true })).toBeNull();
  });

  it("respects a handler that already consumed the key", () => {
    expect(resolveGraphEscape({ ...base, zen: true, defaultPrevented: true })).toBeNull();
  });

  it("restores the HUD on Esc and keeps the selection for a second Esc", () => {
    // The zen exit does not clear the selection: the inspector reappears with the HUD.
    const afterZenExit = { ...base, zen: false, inspectorOpen: true };
    expect(resolveGraphEscape(afterZenExit)).toBe("close-inspector");
  });
});
