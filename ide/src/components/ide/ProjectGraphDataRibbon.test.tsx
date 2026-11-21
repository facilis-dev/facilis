// The data ribbon's rendered contract (issue #70), as static markup (the ide/ pattern: no
// jsdom): three named counters carrying the scan's counts, and a legend that names every stroke
// the lens encodes. The counters-equal-the-scan semantics live in graph-data-lens.test.ts; the
// browser gate proves the live DOM scan.
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale } from "@/i18n";
import type { DataCounts } from "@/facilis/graph-data-lens";
import { ProjectGraphDataRibbon } from "./ProjectGraphDataRibbon";

const counts: DataCounts = { unscopedTables: 3, definerViews: 2, elevatedEdges: 4 };

function markup(disabled = false): string {
  return renderToStaticMarkup(<ProjectGraphDataRibbon counts={counts} disabled={disabled} />);
}

function counter(html: string, id: string): string {
  const start = html.indexOf('data-testid="graph-data-' + id + '"');
  expect(start).toBeGreaterThanOrEqual(0);
  const slice = html.slice(start);
  return slice.slice(0, slice.indexOf("</span>") + "</span>".length);
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphDataRibbon", () => {
  it("renders the three counters as a named group, each with its count", () => {
    const html = markup();
    expect(html).toContain('data-testid="graph-data-ribbon"');
    expect(html).toContain('aria-label="Data lens"');
    expect(counter(html, "unscoped")).toContain(">3<");
    expect(counter(html, "definer")).toContain(">2<");
    expect(counter(html, "elevated")).toContain(">4<");
  });

  it("names every counter with a glyph and a label, never colour alone", () => {
    const html = markup();
    for (const id of ["unscoped", "definer", "elevated"]) {
      const chip = counter(html, id);
      expect(chip).toContain("<svg");
      expect(chip).toContain("title=");
    }
    expect(html).toContain("No scope");
    expect(html).toContain("Definer views");
    expect(html).toContain("Elevated");
  });

  it("legends all five encoded strokes with a dash sample and a named pattern", () => {
    const html = markup();
    expect(html).toContain('data-testid="graph-data-legend"');
    for (const id of ["fk", "relation", "view-base", "route-view", "elevated"]) {
      expect(html).toContain('data-testid="graph-data-legend-' + id + '"');
    }
    expect(html).toContain("Foreign key — solid");
    expect(html).toContain("Relation — dashed");
    expect(html).toContain("View → base — short dash");
    expect(html).toContain("Route → view — dash-dot");
    expect(html).toContain("Elevated — dotted + lock");
    // Every legend entry draws its own stroke sample: the pattern is visible, not only named.
    const legend = html.slice(html.indexOf('data-testid="graph-data-legend"'));
    expect((legend.match(/<svg/g) ?? []).length).toBe(5);
    expect(legend).toContain('stroke-dasharray="6 3"');
    expect(legend).toContain('stroke-dasharray="1 3"');
  });

  it("mutes with the HUD when no analysis is loaded", () => {
    expect(markup(true)).toContain("opacity-50");
    expect(markup(false)).not.toContain("opacity-50");
  });

  it("speaks Italian when the locale is it", () => {
    setLocale("it");
    const html = markup();
    expect(html).toContain("Lente dati");
    expect(html).toContain("Senza scope");
    expect(html).toContain("Viste definer");
    expect(html).toContain("continuo");
    expect(html).toContain("punteggiato + lucchetto");
  });
});
