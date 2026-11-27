// The visible commit list's markup (issue #226). ide/ ships no jsdom: the static markup is
// asserted for the ARIA listbox and its single roving tab stop, and the key rules live in the
// pure model test. Real focus movement needs the browser (pnpm ide:smoke).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale, t } from "@/i18n";
import { buildCommitGraph, type CommitInput } from "@/facilis/commit-graph-model";
import { CommitGraphList } from "./CommitGraphList";

function commit(
  oid: string,
  parents: readonly string[] = [],
  message = "subject " + oid,
): CommitInput {
  return { oid, parents, message, author: "Ada", timestamp: 0 };
}

const graph = buildCommitGraph({
  commits: [commit("c3", ["c2"], "Third commit"), commit("c2", ["c1"]), commit("c1")],
  branches: [{ name: "main", oid: "c3" }],
  head: "main",
});

function markup(selectedId: string | null): string {
  return renderToStaticMarkup(
    <CommitGraphList graph={graph} selectedId={selectedId} onSelect={() => {}} />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("CommitGraphList", () => {
  it("renders a labelled listbox with one option per commit", () => {
    const html = markup(null);
    expect(html).toContain('data-testid="commit-graph-list"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-label="' + t("commitGraph.list.label") + '"');
    expect(html.match(/role="option"/g)).toHaveLength(3);
    expect(html).toContain(t("commitGraph.list.hint"));
  });

  it("gives the whole list exactly one tab stop", () => {
    const html = markup(null);
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(2);
  });

  it("moves the tab stop (and aria-selected) to the selected commit", () => {
    const html = markup("c2");
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('aria-selected="true"');
    expect(html.match(/aria-selected="false"/g)).toHaveLength(2);
    // The accessible name carries the summary and the short hash, so a screen reader can
    // identify the commit without reading the canvas.
    expect(html).toContain('aria-label="subject c2 (c2)"');
    expect(html).toContain('role="status"');
    expect(html).toContain(t("commitGraph.list.selected", { message: "subject c2", short: "c2" }));
  });

  it("shows the summary, the short hash and the HEAD badge", () => {
    const html = markup("c3");
    expect(html).toContain("Third commit");
    expect(html).toContain(">c3<");
    expect(html).toContain(t("commitGraph.head"));
  });
});
