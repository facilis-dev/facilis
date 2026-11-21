// The minimap's rendered contract (issue #68 criterion 3), as static markup (the ide/ pattern:
// no jsdom). The projection/drag math lives in graph-minimap.test.ts; the browser gate proves
// the live drag. Here: one rect per node coloured by the semantic kind role, the viewport
// rectangle, the accessible name and the keyboard affordance.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale } from "@/i18n";
import type { MinimapNode } from "@/facilis/graph-minimap";
import { ProjectGraphMinimap } from "./ProjectGraphMinimap";

const nodes: MinimapNode[] = [
  { id: "page:a", kind: "page", x: 0, y: 0, width: 224, height: 157 },
  { id: "table:todos", kind: "table", x: 680, y: 0, width: 240, height: 80 },
  // A collapsed card draws its real, smaller bounds — a #62 cluster super-node reads the same.
  { id: "table:collapsed", kind: "table", x: 680, y: 120, width: 240, height: 32 },
];

function markup(viewport: { x: number; y: number; zoom: number } | null): string {
  return renderToStaticMarkup(
    <ProjectGraphMinimap
      nodes={nodes}
      viewport={viewport}
      containerRef={{ current: null }}
      onPan={vi.fn()}
      onPanEnd={vi.fn()}
    />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphMinimap", () => {
  it("draws one rect per node with the semantic kind role fill (D-044)", () => {
    const html = markup({ x: 0, y: 0, zoom: 0.5 });
    expect(html).toContain('data-testid="graph-minimap-node-page:a"');
    expect(html).toContain('data-testid="graph-minimap-node-table:todos"');
    expect(html).toContain('fill="var(--success)"');
    expect(html).toContain('fill="var(--muted-foreground)"');
    expect(html).not.toContain("oklch");
    expect(html).not.toContain("#");
  });

  it("reflects the real viewport as a rectangle", () => {
    const html = markup({ x: -100, y: -50, zoom: 0.5 });
    expect(html).toContain('data-testid="graph-minimap-viewport"');
    const rect = html.slice(html.indexOf('data-testid="graph-minimap-viewport"'));
    expect(rect).toContain('stroke="var(--primary)"');
    // The visible world at zoom 0.5 from origin (-100,-50) starts at world (200,100).
    expect(rect).toMatch(/x="-?[\d.]+"/);
  });

  it("changes the viewport rectangle when the viewport changes", () => {
    const wide = markup({ x: 0, y: 0, zoom: 0.4 });
    const tight = markup({ x: 0, y: 0, zoom: 1.6 });
    const widthOf = (html: string) => {
      const rect = html.slice(html.indexOf('data-testid="graph-minimap-viewport"'));
      return Number(rect.match(/width="([\d.]+)"/)?.[1] ?? 0);
    };
    expect(widthOf(wide)).toBeGreaterThan(widthOf(tight));
  });

  it("is a named, focusable group with the arrow-key hint", () => {
    const html = markup({ x: 0, y: 0, zoom: 1 });
    expect(html).toContain('data-testid="graph-minimap"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("Minimap: drag to move the view");
    expect(html).toContain("arrow keys");
  });

  it("renders nothing without nodes or without a viewport", () => {
    expect(markup(null)).toBe("");
    const empty = renderToStaticMarkup(
      <ProjectGraphMinimap
        nodes={[]}
        viewport={{ x: 0, y: 0, zoom: 1 }}
        containerRef={{ current: null }}
        onPan={vi.fn()}
        onPanEnd={vi.fn()}
      />,
    );
    expect(empty).toBe("");
  });

  it("speaks Italian when the locale is it", () => {
    setLocale("it");
    expect(markup({ x: 0, y: 0, zoom: 1 })).toContain("Minimappa");
  });
});
