// Static-markup assertions for the Tab-moves-focus readout (issue #210). The component speaks
// through role="status" and through a visible chip; neither needs a DOM to render, which is what
// lets this be a Vitest case here. Whether focus actually leaves the editor after Ctrl+M + Tab
// needs a browser and stays a pnpm ide:smoke step.

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { en } from "@/i18n/en";
import { initI18n, setLocale } from "@/i18n";
import { tabFocusMode } from "@/vv/tab-focus-mode";
import { TabFocusModeStatus } from "./TabFocusModeStatus";

beforeEach(() => {
  initI18n();
  setLocale("en");
  tabFocusMode.set(false);
});

const render = () => renderToStaticMarkup(<TabFocusModeStatus />);

describe("TabFocusModeStatus", () => {
  it("announces the mode in a status line and says it is off to begin with", () => {
    const html = render();
    expect(html).toContain('role="status"');
    expect(html).toContain(en["a11y.tabFocus.off"]);
  });

  it("shows the chip and announces the on state after the command runs", () => {
    tabFocusMode.set(true);
    const html = render();
    expect(html).toContain(en["a11y.tabFocus.on"]);
    expect(html).not.toContain(en["a11y.tabFocus.off"]);
    expect(html).toContain('role="status"');
  });
});
