// ide/ ships no jsdom or testing-library: the close mark's classes are asserted on the
// static markup (the pattern of RecentProjectsRow.test.tsx).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale, t } from "@/i18n";
import { PreviewTabClose } from "./PreviewTabClose";

function markup(active: boolean): string {
  return renderToStaticMarkup(<PreviewTabClose active={active} onClose={vi.fn()} />);
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("PreviewTabClose", () => {
  it("names the close control through the catalogue", () => {
    const html = markup(false);
    expect(html).toContain(`aria-label="${t("preview.close")}"`);
    expect(html).toContain(`title="${t("preview.close")}"`);
  });

  it("keeps the active tab's close mark visible", () => {
    const html = markup(true);
    expect(html).toContain("opacity-100");
    expect(html).not.toContain("opacity-0");
  });

  it("reveals an inactive tab's close mark on focus as well as hover", () => {
    const html = markup(false);
    expect(html).toContain("opacity-0");
    expect(html).toContain("transition-opacity");
    expect(html).toContain("group-focus-within:opacity-100");
    expect(html).toContain("group-hover:opacity-100");
    // display:none could never be focused, so the reveal would not fire.
    expect(html).not.toContain("hidden");
  });
});
