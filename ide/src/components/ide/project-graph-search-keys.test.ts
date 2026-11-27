// The search popup state machine (issue #220): open/close, roving selection and keys. The DOM
// focus move and the Escape handoff need a browser; every decision is pure and pinned here.

import { describe, expect, it } from "vitest";
import {
  isGraphSearchOpen,
  moveGraphSearchIndex,
  resolveGraphSearchKey,
  type GraphSearchKeyInput,
} from "./project-graph-search-keys.ts";

const BASE: GraphSearchKeyInput = {
  key: "",
  fromInput: true,
  query: "todo",
  activeIndex: -1,
  resultCount: 3,
};

describe("isGraphSearchOpen", () => {
  it("keeps the list mounted while focus stays in the control and the query is not blank", () => {
    expect(isGraphSearchOpen("todo", true)).toBe(true);
    expect(isGraphSearchOpen("todo", false)).toBe(false);
    expect(isGraphSearchOpen("   ", true)).toBe(false);
    expect(isGraphSearchOpen("", true)).toBe(false);
  });
});

describe("moveGraphSearchIndex", () => {
  it("enters the list from the input and wraps at both ends", () => {
    expect(moveGraphSearchIndex(-1, 1, 3)).toBe(0);
    expect(moveGraphSearchIndex(-1, -1, 3)).toBe(2);
    expect(moveGraphSearchIndex(2, 1, 3)).toBe(0);
    expect(moveGraphSearchIndex(0, -1, 3)).toBe(2);
  });

  it("parks the focus at -1 when there is nothing to move over", () => {
    expect(moveGraphSearchIndex(-1, 1, 0)).toBe(-1);
    expect(moveGraphSearchIndex(2, -1, 0)).toBe(-1);
  });

  it("recovers when the result set shrank under the active index", () => {
    expect(moveGraphSearchIndex(5, 1, 3)).toBe(0);
    expect(moveGraphSearchIndex(5, -1, 3)).toBe(2);
  });
});

describe("resolveGraphSearchKey", () => {
  it("moves the roving focus with the arrows and ignores them on an empty list", () => {
    expect(resolveGraphSearchKey({ ...BASE, key: "ArrowDown" })).toEqual({
      kind: "move",
      index: 0,
    });
    expect(resolveGraphSearchKey({ ...BASE, key: "ArrowUp" })).toEqual({
      kind: "move",
      index: 2,
    });
    expect(resolveGraphSearchKey({ ...BASE, key: "ArrowDown", resultCount: 0 })).toEqual({
      kind: "none",
    });
  });

  it("jumps to the active option and falls back to the first match from the input", () => {
    expect(resolveGraphSearchKey({ ...BASE, key: "Enter", activeIndex: 1 })).toEqual({
      kind: "jump",
      index: 1,
    });
    expect(resolveGraphSearchKey({ ...BASE, key: "Enter" })).toEqual({ kind: "submit" });
    expect(
      resolveGraphSearchKey({ ...BASE, key: "Enter", fromInput: false, resultCount: 0 }),
    ).toEqual({ kind: "none" });
  });

  it("clears a non-empty query first and closes an empty popup next", () => {
    expect(resolveGraphSearchKey({ ...BASE, key: "Escape" })).toEqual({ kind: "clear" });
    expect(resolveGraphSearchKey({ ...BASE, key: "Escape", query: "" })).toEqual({
      kind: "close",
    });
  });

  it("leaves every other key to the browser", () => {
    expect(resolveGraphSearchKey({ ...BASE, key: "Tab" })).toEqual({ kind: "none" });
    expect(resolveGraphSearchKey({ ...BASE, key: "a" })).toEqual({ kind: "none" });
  });
});
