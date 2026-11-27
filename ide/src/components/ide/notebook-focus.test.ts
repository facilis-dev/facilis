// The notebook's one-cell focus request (issue #221). A cell edit starts before the
// editor that will hold the keyboard exists, so the request has to wait for the
// registration rather than for the click.
import { describe, expect, it } from "vitest";
import { NotebookFocus } from "./notebook-focus";

class FakeElement {
  focused = 0;
  focus(): void {
    this.focused += 1;
  }
}

describe("NotebookFocus", () => {
  it("focuses an element that is already mounted", () => {
    const focus = new NotebookFocus();
    const element = new FakeElement();
    focus.register("cell-1", element);
    focus.request("cell-1");
    expect(element.focused).toBe(1);
  });

  it("waits for the element when the request arrives first", () => {
    const focus = new NotebookFocus();
    focus.request("cell-1");
    const element = new FakeElement();
    focus.register("cell-1", element);
    expect(element.focused).toBe(1);
  });

  it("does not steal focus for a cell nobody requested", () => {
    const focus = new NotebookFocus();
    focus.request("cell-1");
    const other = new FakeElement();
    focus.register("cell-2", other);
    expect(other.focused).toBe(0);
  });

  it("hands Escape to the control that replaces the editor", () => {
    const focus = new NotebookFocus();
    const editor = new FakeElement();
    const rendered = new FakeElement();
    focus.register("cell-1", editor);
    focus.focusNext("cell-1");
    expect(editor.focused).toBe(0);
    focus.register("cell-1", rendered);
    expect(rendered.focused).toBe(1);
  });

  it("keeps a newer registration when a late cleanup unregisters the old one", () => {
    const focus = new NotebookFocus();
    const old = new FakeElement();
    const current = new FakeElement();
    focus.register("cell-1", old);
    focus.register("cell-1", current);
    focus.unregister("cell-1", old);
    focus.request("cell-1");
    expect(current.focused).toBe(1);
  });
});
