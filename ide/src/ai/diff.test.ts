import { describe, expect, it } from "vitest";
import { fileDiff } from "./diff";

function file(...lines: string[]): string {
  return lines.join("\n") + "\n";
}

describe("fileDiff", () => {
  it("marks a created file as all additions", () => {
    const diff = fileDiff(null, "a\nb\n");
    expect(diff.lines).toEqual([
      { kind: "add", text: "a" },
      { kind: "add", text: "b" },
    ]);
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(0);
    expect(diff.truncated).toBe(false);
  });

  it("marks a deleted file as all removals", () => {
    const diff = fileDiff("a\nb\n", null);
    expect(diff.lines).toEqual([
      { kind: "del", text: "a" },
      { kind: "del", text: "b" },
    ]);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(2);
    expect(diff.truncated).toBe(false);
  });

  it("returns nothing for identical content, empty content and two nulls", () => {
    const empty = { lines: [], added: 0, removed: 0, truncated: false };
    expect(fileDiff("a\nb\n", "a\nb\n")).toEqual(empty);
    expect(fileDiff("", "")).toEqual(empty);
    expect(fileDiff(null, null)).toEqual(empty);
    // A final newline does not create a line, so these two describe the same file.
    expect(fileDiff("a\n", "a")).toEqual(empty);
  });

  it("renders a modify as a unified hunk with three lines of context", () => {
    const before = file(...Array.from({ length: 10 }, (_, index) => "line " + index));
    const after = before.replace("line 4", "changed");
    const diff = fileDiff(before, after);

    expect(diff.lines[0]).toEqual({ kind: "hunk", text: "@@ -2,7 +2,7 @@" });
    expect(diff.lines.slice(1).map((line) => line.kind + ":" + line.text)).toEqual([
      "ctx:line 1",
      "ctx:line 2",
      "ctx:line 3",
      "del:line 4",
      "add:changed",
      "ctx:line 5",
      "ctx:line 6",
      "ctx:line 7",
    ]);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.truncated).toBe(false);
  });

  it("splits changes further apart than the context into separate hunks", () => {
    const before = file(...Array.from({ length: 20 }, (_, index) => "l" + index));
    const after = before.replace("l2", "X").replace("l17", "Y");
    const diff = fileDiff(before, after);
    const headers = diff.lines.filter((line) => line.kind === "hunk").map((line) => line.text);
    expect(headers).toHaveLength(2);
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(2);
  });

  it("caps the rendered lines at 400 and reports truncation", () => {
    const before = file(...Array.from({ length: 500 }, (_, index) => "old " + index));
    const after = file(...Array.from({ length: 500 }, (_, index) => "new " + index));
    const diff = fileDiff(before, after);
    expect(diff.lines).toHaveLength(400);
    expect(diff.truncated).toBe(true);
    // Counts describe the whole diff, not the truncated rendering.
    expect(diff.added).toBe(500);
    expect(diff.removed).toBe(500);
  });

  it("falls back to a whole-file replacement when the DP would be too large", () => {
    const before = file(...Array.from({ length: 1200 }, (_, index) => "old " + index));
    const after = file(...Array.from({ length: 1200 }, (_, index) => "new " + index));
    const diff = fileDiff(before, after);
    expect(diff.lines).toHaveLength(400);
    expect(diff.lines[0]?.kind).toBe("hunk");
    expect(diff.truncated).toBe(true);
    expect(diff.added).toBe(1200);
    expect(diff.removed).toBe(1200);
  });

  it("handles a modify where one side is empty", () => {
    const created = fileDiff("", "x\n");
    expect(created.lines).toEqual([{ kind: "add", text: "x" }]);
    expect(created.added).toBe(1);

    const deleted = fileDiff("x\n", "");
    expect(deleted.lines).toEqual([{ kind: "del", text: "x" }]);
    expect(deleted.removed).toBe(1);
  });
});
