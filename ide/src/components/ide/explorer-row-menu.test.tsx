import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { treeItemAttributes } from "./explorer-tree-model";
import { ExplorerRowMenu } from "./explorer-row-menu";

const noop = () => {};
const controller = {
  openTerminalIn: noop,
  copyPath: noop,
  exportProjectZip: async () => {},
  shareProject: async () => null,
  pasteInto: async () => {},
};

// The trigger IS the treeitem: a wrapper div between `role="tree"` and the row would
// break aria-required-children (and focus restoration on close).
const markup = (options: { expanded?: boolean } = { expanded: true }) =>
  renderToStaticMarkup(
    <div role="tree">
      <ExplorerRowMenu
        trigger={
          <div
            {...treeItemAttributes({
              focused: true,
              selected: true,
              level: 2,
              expanded: options.expanded,
            })}
          >
            src
          </div>
        }
        abs="/w/src"
        isDir
        destDir="/w/src"
        c={controller}
        canPaste={false}
        open={false}
        anchorAtRow={false}
        onOpenChange={noop}
        onContextMenuOpen={noop}
        onCopy={noop}
        onCut={noop}
        onOpen={noop}
        onRename={noop}
        onDelete={noop}
        onNewFile={noop}
        onNewFolder={noop}
      />
    </div>,
  );

describe("ExplorerRowMenu", () => {
  it("renders the row as the context-menu trigger, without a wrapper element", () => {
    const html = markup();
    expect(html.startsWith('<div role="tree"><div ')).toBe(true);
    expect(html).toContain('data-slot="context-menu-trigger"');
    expect(html).toContain('role="treeitem"');
    expect(html.endsWith(">src</div></div>")).toBe(true);
    // Two divs in total: the tree and the treeitem. The menu popup is a portal and
    // never renders on the server, so a third div would be a wrapper around the row.
    expect(html.split("<div ")).toHaveLength(3);
  });

  it("announces the row's level, expansion and selection", () => {
    const html = markup();
    expect(html).toContain('aria-level="2"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('tabindex="0"');
  });

  it("gives a file no expanded state", () => {
    const html = markup({ expanded: undefined });
    expect(html).not.toContain("aria-expanded");
    expect(html).toContain('aria-level="2"');
  });
});
