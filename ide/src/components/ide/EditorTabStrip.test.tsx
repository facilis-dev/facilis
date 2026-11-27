import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@/i18n";
import { EditorTabStrip } from "./EditorTabStrip";

const noop = () => {};

// The strip is rendered on the server because the IDE ships no jsdom: this proves the
// ARIA contract (tablist -> tab, one tab stop, labels), not focus movement — that stays
// a browser step (pnpm ide:smoke).
const markup = (over: { openTabs?: string[]; activeTab?: string; dirty?: string[] } = {}) => {
  const openTabs = over.openTabs ?? ["/w/a.ts", "/w/b.ts"];
  return renderToStaticMarkup(
    <EditorTabStrip
      openTabs={openTabs}
      activeTab={over.activeTab ?? "/w/b.ts"}
      previewTab={null}
      dirty={over.dirty ?? []}
      tabKinds={{}}
      focusRequest={null}
      onActivate={noop}
      onPin={noop}
      onClose={noop}
      onReorder={noop}
    />,
  );
};

beforeAll(() => {
  initI18n();
});

describe("EditorTabStrip", () => {
  it("is a labelled tablist of tabs", () => {
    const html = markup();
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Open editors"');
    expect(html.split('role="tab"')).toHaveLength(3);
    // The Base UI trigger is presentational, so the tabs are the tablist's children.
    expect(html).toContain('role="presentation"');
  });

  it("exposes selection and exactly one tab stop, on the active tab", () => {
    const html = markup();
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-selected="false"');
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    // The active tab is the second one and carries the stop: tabindex="0" follows
    // its aria-selected="true".
    expect(html.indexOf('aria-selected="true"')).toBeLessThan(html.indexOf('tabindex="0"'));
    expect(html.lastIndexOf('aria-selected="false"')).toBeLessThan(html.indexOf('tabindex="0"'));
  });

  it("announces a dirty tab and names each close control after its file", () => {
    const html = markup({ dirty: ["/w/b.ts"] });
    expect(html).toContain('aria-label="b.ts (unsaved changes)"');
    // Issue #225: a bare "Close" per tab reads as "Close, Close, Close" to a screen
    // reader, with no way to tell which file is about to be closed.
    expect(html).toContain('aria-label="Close b.ts"');
    expect(html).toContain('title="Close a.ts"');
  });

  it("renders synthetic tabs with their own label and no basename", () => {
    const html = markup({
      openTabs: ["/w/a.ts", "vv-project-graph"],
      activeTab: "vv-project-graph",
    });
    expect(html).toContain('aria-label="Project graph"');
    expect(html).toContain('title="Project graph"');
  });
});
