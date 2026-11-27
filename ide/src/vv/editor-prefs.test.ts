// The terminal escape chord's destination decision (issue #211), driven from Node like the
// word-wrap matcher: the IDE ships no jsdom, so the DOM half (moving focus) stays manual.
import { describe, expect, it } from "vitest";
import { terminalFocusTarget } from "./editor-prefs";

const f6 = { key: "F6", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

describe("terminalFocusTarget", () => {
  it("leaves a focused terminal with F6", () => {
    expect(terminalFocusTarget(f6, true)).toBe("panel");
  });

  it("returns to the terminal with F6 from anywhere else", () => {
    expect(terminalFocusTarget(f6, false)).toBe("terminal");
  });

  it("returns to the terminal with Shift+F6 wherever focus is", () => {
    expect(terminalFocusTarget({ ...f6, shiftKey: true }, true)).toBe("terminal");
    expect(terminalFocusTarget({ ...f6, shiftKey: true }, false)).toBe("terminal");
  });

  it("does not claim another key or a modifier chord", () => {
    expect(terminalFocusTarget({ ...f6, key: "F5" }, true)).toBeNull();
    expect(terminalFocusTarget({ ...f6, ctrlKey: true }, true)).toBeNull();
    expect(terminalFocusTarget({ ...f6, metaKey: true }, true)).toBeNull();
    expect(terminalFocusTarget({ ...f6, altKey: true }, true)).toBeNull();
  });
});
