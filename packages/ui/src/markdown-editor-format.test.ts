import { describe, expect, it } from "vitest";
import {
  insertLink,
  toggleLinePrefix,
  toggleOrderedList,
  wrapSelection,
} from "./markdown-editor-format.ts";

describe("wrapSelection", () => {
  it("wraps the selected text and keeps it selected", () => {
    expect(wrapSelection({ value: "hello world", start: 6, end: 11 }, "**")).toEqual({
      value: "hello **world**",
      start: 8,
      end: 13,
    });
  });

  it("inserts an empty pair at the caret", () => {
    expect(wrapSelection({ value: "", start: 0, end: 0 }, "_")).toEqual({
      value: "__",
      start: 1,
      end: 1,
    });
  });
});

describe("insertLink", () => {
  it("wraps the label and selects the URL placeholder", () => {
    expect(insertLink({ value: "docs", start: 0, end: 4 })).toEqual({
      value: "[docs](https://)",
      start: 7,
      end: 15,
    });
  });
});

describe("toggleLinePrefix", () => {
  it("prefixes every selected line and toggles it off again", () => {
    const added = toggleLinePrefix({ value: "one\ntwo", start: 0, end: 7 }, "- ");
    expect(added.value).toBe("- one\n- two");
    expect(added.start).toBe(0);
    expect(added.end).toBe(11);

    const removed = toggleLinePrefix(added, "- ");
    expect(removed.value).toBe("one\ntwo");
  });

  it("keeps blank lines blank", () => {
    expect(toggleLinePrefix({ value: "one\n\ntwo", start: 0, end: 8 }, "> ").value).toBe(
      "> one\n\n> two",
    );
  });
});

describe("toggleOrderedList", () => {
  it("numbers selected lines and strips the numbering again", () => {
    const numbered = toggleOrderedList({ value: "one\ntwo\nthree", start: 0, end: 13 });
    expect(numbered.value).toBe("1. one\n2. two\n3. three");

    expect(toggleOrderedList(numbered).value).toBe("one\ntwo\nthree");
  });
});
