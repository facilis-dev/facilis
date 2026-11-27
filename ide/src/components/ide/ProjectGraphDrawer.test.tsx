// Static-markup tests for the inspector drawer's dialog semantics (issue #216). The focus move,
// the Tab trap and the return-to-opener need a browser (pnpm ide:smoke); what a string render can
// prove is that the drawer declares itself a named modal dialog and is itself focusable.

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale, t } from "@/i18n";
import { ProjectGraphDrawer } from "./ProjectGraphDrawer";

beforeEach(() => {
  initI18n();
  setLocale("en");
});

function render(): string {
  return renderToStaticMarkup(
    <ProjectGraphDrawer onClose={vi.fn()}>
      <p>details</p>
    </ProjectGraphDrawer>,
  );
}

describe("ProjectGraphDrawer", () => {
  it("is a named modal dialog the keyboard can enter and leave", () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="' + t("projectGraph.drawer") + '"');
    // The container takes focus on open, before its content is announced.
    expect(html).toContain('tabindex="-1"');
  });

  it("keeps the layout marker the camera and the smoke gate read", () => {
    expect(render()).toContain('data-layout="side"');
  });
});
