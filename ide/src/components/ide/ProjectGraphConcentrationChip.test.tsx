// The threshold chip markup (issue #64): a role=toolbar cluster of named buttons (the browser
// gate asserts every HUD button is named), aria-pressed on the active threshold, and the
// Italian catalogue for the new keys. Static markup, the RecentProjectsRow.test.tsx pattern.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale, t } from "@/i18n";
import { ProjectGraphConcentrationChip } from "./ProjectGraphConcentrationChip";

function markup(concentration: "off" | 4 | 8): string {
  return renderToStaticMarkup(
    <ProjectGraphConcentrationChip concentration={concentration} onChange={vi.fn()} />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphConcentrationChip", () => {
  it("is a named toolbar with three named buttons (off / 4 / 8)", () => {
    const html = markup(4);
    expect(html).toContain('role="toolbar"');
    expect(html).toContain(t("projectGraph.hud.concentration"));
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toContain(t("projectGraph.concentration.setOff"));
    expect(html).toContain(t("projectGraph.concentration.setThreshold", { count: 4 }));
    expect(html).toContain(t("projectGraph.concentration.setThreshold", { count: 8 }));
    expect(html).toContain('data-testid="graph-concentration-off"');
    expect(html).toContain('data-testid="graph-concentration-4"');
    expect(html).toContain('data-testid="graph-concentration-8"');
  });

  it("marks only the active threshold as pressed", () => {
    expect(markup(4).match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup("off").match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup(8).match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(markup(8)).toContain('data-testid="graph-concentration-8"');
  });

  it("the numeric thresholds stay visible at narrow widths; off collapses to its icon", () => {
    const html = markup(4);
    expect(html).toContain('class="tabular-nums">4</span>');
    expect(html).toContain('class="tabular-nums">8</span>');
    expect(html).toContain("hidden xl:inline");
  });

  it("ships Italian translations for every new key", () => {
    setLocale("it");
    const html = markup(4);
    expect(html).toContain("Concentrazione degli archi");
    expect(html).toContain("Disattiva la concentrazione degli archi");
    expect(html).toContain("Concentra quando più di 4 rotte condividono una tabella");
    expect(html).not.toContain("Edge concentration");
    // The thick hub edge's count label is translated too (drawn by ProjectGraphEdge).
    expect(t("projectGraph.hub.countLabel", { count: 10 })).toBe("10 rotte");
    expect(t("projectGraph.hub.routesTitle", { count: 10 })).toBe("Rotte (10)");
  });

  it("the hub count label is English in the en locale", () => {
    expect(t("projectGraph.hub.countLabel", { count: 10 })).toBe("10 routes");
  });
});
