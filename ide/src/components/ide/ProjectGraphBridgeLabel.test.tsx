// The apex label markup (issue #65): visibility, the LOD counter-scale and the dim state.
// Rendered to a static string — ide/ ships no jsdom (the RecentProjectsRow pattern).
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectGraphBridgeLabel } from "./ProjectGraphBridgeLabel";

const apex = { x: 100, y: -40 };

function markup(props: Partial<Parameters<typeof ProjectGraphBridgeLabel>[0]> = {}): string {
  return renderToStaticMarkup(
    <ProjectGraphBridgeLabel
      apex={apex}
      label="dbTables"
      visible={true}
      dimmed={false}
      {...props}
    />,
  );
}

describe("ProjectGraphBridgeLabel", () => {
  it("renders the label above the apex and hides it from screen readers", () => {
    const html = markup();
    expect(html).toContain("dbTables</text>");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('x="100"');
    expect(html).toContain('y="-40"');
    // The font-relative lift keeps a constant screen gap over a bundle count on the apex.
    expect(html).toContain('dy="-1.3em"');
  });

  it("counter-scales the font through the LOD zoom variable (epic rule 4)", () => {
    const html = markup();
    expect(html).toContain("calc(10px/var(--graph-lod-zoom,1))");
    expect(html).not.toMatch(/font-size:10px[^/]/u);
  });

  it("renders nothing when the LOD level hides it", () => {
    expect(markup({ visible: false })).toBe("");
  });

  it("dims with the other bridges while one is raised", () => {
    expect(markup({ dimmed: true })).toContain("opacity:0.25");
    expect(markup({ dimmed: false })).toContain("opacity:1");
  });
});
