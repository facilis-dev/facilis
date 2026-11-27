// ide/ ships no jsdom: the frame's inert decision is asserted on the static markup. The
// focus movement itself (Tab never leaves Home, the opener gets focus back) is the manual
// step in the issue, driven through Chromium by pnpm ide:smoke.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceFrame } from "./workspace-frame";

function markup(view: "home" | "workspace"): string {
  return renderToStaticMarkup(
    <WorkspaceFrame view={view}>
      <button type="button">workspace</button>
    </WorkspaceFrame>,
  );
}

describe("WorkspaceFrame", () => {
  it("makes the covered workspace inert while Home is open", () => {
    const html = markup("home");
    expect(html).toContain("inert");
    // The regions stay inside the frame, or the attribute would cover nothing; the frame
    // marker is also what scopes Home's focus tracker to workspace controls (#212).
    expect(html).toContain("data-workspace-frame");
    expect(html).toContain("workspace");
  });

  it("leaves the workspace interactive while a project is open", () => {
    expect(markup("workspace")).not.toContain("inert");
  });
});
