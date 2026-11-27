import { describe, expect, it } from "vitest";
import { buildCommitGraph, type CommitInput } from "./commit-graph-model.ts";
import {
  activeCommitRow,
  buildCommitListRows,
  commitListIntent,
  commitListOptionAttributes,
  type CommitListRow,
} from "./commit-graph-list-model.ts";

const commit = (
  oid: string,
  parents: readonly string[] = [],
  extra: Partial<CommitInput> = {},
) => ({
  oid,
  parents,
  message: "subject " + oid,
  author: "Ada",
  timestamp: 0,
  ...extra,
});

function rowsOf(commits: readonly CommitInput[]): readonly CommitListRow[] {
  return buildCommitListRows(buildCommitGraph({ commits, branches: [], head: null }));
}

const rows = rowsOf([
  commit("c3", ["c2"], { message: "Third\n\nBody", author: "Ada" }),
  commit("c2", ["c1"], { author: "Grace" }),
  commit("c1"),
]);

const move = (activeId: string | null, key: string) => commitListIntent(rows, activeId, { key });

describe("buildCommitListRows", () => {
  it("mirrors the model order (newest first) and keeps summary, hash and author", () => {
    expect(rows.map((row) => [row.id, row.oid, row.short, row.summary, row.author])).toEqual([
      ["c3", "c3", "c3", "Third", "Ada"],
      ["c2", "c2", "c2", "subject c2", "Grace"],
      ["c1", "c1", "c1", "subject c1", "Ada"],
    ]);
  });

  it("carries the branch and HEAD facts the row shows", () => {
    const graph = buildCommitGraph({
      commits: [commit("tip", ["base"]), commit("base")],
      branches: [{ name: "main", oid: "tip" }],
      head: "main",
    });
    const listRows = buildCommitListRows(graph);
    expect(listRows[0].head).toBe(true);
    expect(listRows[0].branches).toEqual(["main"]);
    expect(listRows[1].head).toBe(false);
    expect(listRows[1].branches).toEqual([]);
  });

  it("returns no rows for an empty graph", () => {
    expect(
      buildCommitListRows(buildCommitGraph({ commits: [], branches: [], head: null })),
    ).toEqual([]);
  });
});

describe("activeCommitRow", () => {
  it("is the active row, and recovers to the first one when the id is gone", () => {
    expect(activeCommitRow(rows, "c2")?.id).toBe("c2");
    expect(activeCommitRow(rows, "deleted")?.id).toBe("c3");
    expect(activeCommitRow(rows, null)?.id).toBe("c3");
    expect(activeCommitRow([], "c1")).toBeNull();
  });
});

describe("commitListIntent", () => {
  it("moves the active row with the arrows, clamped at both ends", () => {
    expect(move("c2", "ArrowDown")).toEqual({ kind: "active", id: "c1" });
    expect(move("c2", "ArrowUp")).toEqual({ kind: "active", id: "c3" });
    expect(move("c3", "ArrowUp")).toEqual({ kind: "active", id: "c3" });
    expect(move("c1", "ArrowDown")).toEqual({ kind: "active", id: "c1" });
  });

  it("jumps to the ends with Home and End", () => {
    expect(move("c2", "Home")).toEqual({ kind: "active", id: "c3" });
    expect(move("c2", "End")).toEqual({ kind: "active", id: "c1" });
  });

  it("starts from the first row when the active id is gone", () => {
    expect(move("deleted", "ArrowDown")).toEqual({ kind: "active", id: "c2" });
  });

  it("selects the active row on Enter or Space", () => {
    expect(move("c2", "Enter")).toEqual({ kind: "select", id: "c2" });
    expect(move("c2", " ")).toEqual({ kind: "select", id: "c2" });
    expect(move(null, "Enter")).toEqual({ kind: "select", id: "c3" });
  });

  it("clears the selection on Escape", () => {
    expect(move("c2", "Escape")).toEqual({ kind: "clear" });
  });

  it("leaves every other key and every modified chord alone", () => {
    expect(move("c2", "a")).toBeNull();
    expect(move("c2", "Tab")).toBeNull();
    expect(commitListIntent(rows, "c2", { key: "ArrowDown", ctrlKey: true })).toBeNull();
    expect(commitListIntent(rows, "c2", { key: "ArrowDown", shiftKey: true })).toBeNull();
    expect(commitListIntent(rows, "c2", { key: "Home", altKey: true })).toBeNull();
  });

  it("has no intent on an empty list", () => {
    expect(commitListIntent([], null, { key: "ArrowDown" })).toBeNull();
    expect(commitListIntent([], null, { key: "Enter" })).toBeNull();
  });
});

describe("commitListOptionAttributes", () => {
  it("gives the list one tab stop and marks only the selected row", () => {
    const attributes = rows.map((row) =>
      commitListOptionAttributes(row.id === "c2", row.id === "c1"),
    );
    expect(attributes).toEqual([
      { role: "option", "aria-selected": false, tabIndex: -1 },
      { role: "option", "aria-selected": false, tabIndex: 0 },
      { role: "option", "aria-selected": true, tabIndex: -1 },
    ]);
  });
});
