// The apex label markup (issue #65): visibility, the 7 px counter-scale and the dim state.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectGraphBridgeLabel } from "./ProjectGraphBridgeLabel";

const apex = { x: 100, y: -40 };

function markup(props: Partial<Parameters<typeof ProjectGraphBridgeLabel>[0]> = {}): string {
  return renderToStaticMarkup(
    <ProjectGraphBridgeLabel
      apex={apex}
      label="dbTables"
      fontPx={11}
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
    expect(html).toContain('y="-46"');
    expect(html).toContain("font-size:11px");
  });

  it("renders nothing when the zoom floor hides it", () => {
    expect(markup({ visible: false })).toBe("");
  });

  it("dims with the other bridges while one is raised", () => {
    expect(markup({ dimmed: true })).toContain("opacity:0.25");
    expect(markup({ dimmed: false })).toContain("opacity:1");
  });

  it("carries the counter-scaled font size for a revealed low-zoom label", () => {
    expect(markup({ fontPx: 7 / 0.3 })).toContain("font-size:23.3333");
  });
});
