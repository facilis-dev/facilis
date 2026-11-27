// ide/ ships no jsdom or testing-library: the row's controls and the reveal classes are
// asserted on the static markup (the pattern of RecentProjectsRow.test.tsx).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale, t } from "@/i18n";
import { DebugBreakpointRow } from "./DebugBreakpointRow";

function markup(): string {
  return renderToStaticMarkup(
    <DebugBreakpointRow path="/w/app/src/app.ts" line={12} onOpen={vi.fn()} onRemove={vi.fn()} />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("DebugBreakpointRow", () => {
  it("opens the breakpoint from a real button", () => {
    const html = markup();
    expect(html).toContain("app.ts:12");
    expect(html).toContain('title="/w/app/src/app.ts:12"');
  });

  it("reveals the named remove control on focus as well as hover", () => {
    const html = markup();
    expect(html).toContain(`aria-label="${t("debug.removeBreakpoint")}"`);
    expect(html).toContain(`title="${t("debug.removeBreakpoint")}"`);
    expect(html).toContain("opacity-0");
    expect(html).toContain("transition-opacity");
    expect(html).toContain("group-focus-within:opacity-100");
    expect(html).toContain("group-hover:opacity-100");
    expect(html).not.toContain("hidden");
  });
});
