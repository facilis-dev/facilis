// The bridges chip markup (issue #65): aria-pressed, catalogue label and the shortcut hint.
// Rendered to a static string — ide/ ships no jsdom (the RecentProjectsRow pattern).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale } from "@/i18n";
import { ProjectGraphBridgeChip } from "./ProjectGraphBridgeChip";

function markup(bridges: boolean): string {
  return renderToStaticMarkup(<ProjectGraphBridgeChip bridges={bridges} onToggle={vi.fn()} />);
}

describe("ProjectGraphBridgeChip", () => {
  beforeEach(() => {
    initI18n();
    setLocale("en");
  });

  it("is a pressed toggle when bridges are on", () => {
    const html = markup(true);
    expect(html).toContain('data-testid="graph-bridge-chip"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Bridges"');
    expect(html).toContain("(B)");
    expect(html).toContain("Bridges</span>");
  });

  it("is an unpressed toggle when bridges are off", () => {
    const html = markup(false);
    expect(html).toContain('aria-pressed="false"');
  });

  it("translates the label", () => {
    setLocale("it");
    expect(markup(true)).toContain('aria-label="Ponti"');
  });
});
