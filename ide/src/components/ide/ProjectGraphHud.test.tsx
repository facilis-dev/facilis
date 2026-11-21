// The HUD's responsive docking contract (issue #144), as static markup (the ide/ pattern: no
// jsdom). The bottom-left ribbon and the bottom-right zoom/fit cluster must share one floating
// dock row — the left wraps (min-w-0, flex-wrap), the right never shrinks (shrink-0), neither is
// absolutely positioned — so they cannot overlap at narrow widths. The browser gate proves the
// real geometry; here we guard the structure that makes it hold, and that the top clusters still
// anchor absolutely and every zone stays measurable for fit padding.

import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale } from "@/i18n";
import { EMPTY_STATS_FILTER } from "@/facilis/graph-stats-filter";
import type { GraphViewMode } from "@/facilis/graph-view-state";
import { ProjectGraphHud } from "./ProjectGraphHud";

function markup(
  slots: {
    lensChips?: ReactNode;
    runtimeControls?: ReactNode;
    auditRibbon?: ReactNode;
    dataRibbon?: ReactNode;
    mode?: GraphViewMode;
  } = {},
): string {
  return renderToStaticMarkup(
    <ProjectGraphHud
      stats={null}
      query=""
      onQueryChange={vi.fn()}
      saveState="idle"
      saveError={null}
      onSave={vi.fn()}
      onRefresh={vi.fn()}
      refreshing={false}
      zen={false}
      onToggleZen={vi.fn()}
      focusActive={false}
      onClearFocus={vi.fn()}
      errors={0}
      warnings={0}
      onFit={vi.fn()}
      onZoomIn={vi.fn()}
      onZoomOut={vi.fn()}
      filter={EMPTY_STATS_FILTER}
      onToggleKind={vi.fn()}
      onToggleEdges={vi.fn()}
      lensChips={slots.lensChips ?? <div data-testid="lens-chips-slot" />}
      focusBar={null}
      breadcrumbs={<nav data-testid="breadcrumbs-slot" />}
      clusterControls={null}
      minimap={<div data-testid="minimap-slot-content" />}
      onOpenPalette={vi.fn()}
      onOpenSheet={vi.fn()}
      runtimeControls={slots.runtimeControls ?? <div data-testid="runtime-controls-slot" />}
      auditRibbon={slots.auditRibbon ?? null}
      dataRibbon={slots.dataRibbon ?? null}
      turnRibbon={null}
      tableVisibility="project"
      onTableVisibilityChange={vi.fn()}
      mode={slots.mode ?? "topology"}
      onModeChange={vi.fn()}
      onAddNote={vi.fn()}
      onResetLayout={vi.fn()}
    />,
  );
}

/** The opening tag of the element carrying a testid, so its classes can be inspected. */
function openingTag(html: string, testId: string): string {
  const at = html.indexOf('data-testid="' + testId + '"');
  expect(at, testId).toBeGreaterThanOrEqual(0);
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
}

const DOCK_ROW =
  "pointer-events-none absolute inset-x-2 bottom-2 flex items-end justify-between gap-2";

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphHud bottom dock (issue 144)", () => {
  it("docks the bottom-left and bottom-right clusters in one floating flex row", () => {
    const html = markup();
    const dockAt = html.indexOf(DOCK_ROW);
    expect(dockAt).toBeGreaterThanOrEqual(0);
    // Both bottom clusters live inside the dock row, left before right.
    const leftAt = html.indexOf('data-testid="graph-hud-bottom-left"');
    const rightAt = html.indexOf('data-testid="graph-hud-bottom-right"');
    expect(leftAt).toBeGreaterThan(dockAt);
    expect(rightAt).toBeGreaterThan(leftAt);
    // The row floats over the canvas without blocking it; the clusters re-enable pointers.
    expect(html.slice(dockAt, html.indexOf(">", dockAt))).toContain("pointer-events-none");
  });

  it("lets the ribbon shrink and wrap, and never shrinks the zoom cluster", () => {
    const html = markup();
    const left = openingTag(html, "graph-hud-bottom-left");
    expect(left).toContain("min-w-0");
    expect(left).toContain("flex-wrap");
    expect(left).not.toContain("absolute");
    const right = openingTag(html, "graph-hud-bottom-right");
    expect(right).toContain("shrink-0");
    expect(right).not.toContain("absolute");
  });

  it("keeps the top clusters absolutely anchored and every zone measurable", () => {
    const html = markup();
    expect(openingTag(html, "graph-hud-top-left")).toContain("absolute");
    expect(openingTag(html, "graph-hud-top-right")).toContain("absolute");
    for (const zone of [
      "graph-hud-top-left",
      "graph-hud-top-right",
      "graph-hud-bottom-left",
      "graph-hud-bottom-right",
    ]) {
      expect(openingTag(html, zone)).toContain("data-hud-zone");
    }
  });

  it("keeps the zoom/fit controls named and docked on the right", () => {
    const html = markup();
    const right = openingTag(html, "graph-hud-bottom-right");
    expect(right).toContain('role="toolbar"');
    for (const id of ["graph-hud-zoom-out", "graph-hud-zoom-in", "graph-hud-fit"]) {
      const tag = openingTag(html, id);
      expect(tag).toMatch(/aria-label="[^"]+"/);
      expect(html.indexOf('data-testid="' + id + '"')).toBeGreaterThan(
        html.indexOf('data-testid="graph-hud-bottom-right"'),
      );
    }
  });

  it("docks the lens chips and runtime controls slots inside the ribbon", () => {
    const html = markup();
    const leftAt = html.indexOf('data-testid="graph-hud-bottom-left"');
    const rightAt = html.indexOf('data-testid="graph-hud-bottom-right"');
    for (const slot of ["lens-chips-slot", "runtime-controls-slot"]) {
      const at = html.indexOf('data-testid="' + slot + '"');
      expect(at).toBeGreaterThan(leftAt);
      expect(at).toBeLessThan(rightAt);
    }
  });
});

describe("ProjectGraphHud navigation slots (issue #68)", () => {
  it("fills the docked minimap slot inside the bottom-right cluster", () => {
    const html = markup();
    const rightAt = html.indexOf('data-testid="graph-hud-bottom-right"');
    const slotAt = html.indexOf('data-testid="graph-hud-minimap-slot"');
    const contentAt = html.indexOf('data-testid="minimap-slot-content"');
    expect(slotAt).toBeGreaterThan(rightAt);
    expect(contentAt).toBeGreaterThan(slotAt);
    // The slot is no longer hidden: the minimap renders in the dock, not in a side panel.
    expect(openingTag(html, "graph-hud-minimap-slot")).not.toContain("hidden");
    // The zoom/fit cluster keeps data-hud-zone so fit padding still measures it.
    expect(openingTag(html, "graph-hud-bottom-right")).toContain("data-hud-zone");
  });

  it("renders the breadcrumb trail top-left instead of the static title", () => {
    const html = markup();
    const leftAt = html.indexOf('data-testid="graph-hud-top-left"');
    const breadcrumbsAt = html.indexOf('data-testid="breadcrumbs-slot"');
    const modeAt = html.indexOf('data-testid="graph-hud-mode-slot"');
    expect(breadcrumbsAt).toBeGreaterThan(leftAt);
    expect(breadcrumbsAt).toBeLessThan(modeAt);
  });

  it("exposes named palette and shortcut-sheet triggers", () => {
    const html = markup();
    for (const id of ["graph-hud-palette", "graph-hud-shortcuts"]) {
      expect(openingTag(html, id)).toMatch(/aria-label="[^"]+"/);
    }
  });
});

describe("ProjectGraphHud mode switcher (issue #67)", () => {
  it("fills the top-left mode slot with named, keyboard-reachable topology/matrix buttons", () => {
    const html = markup();
    const slot = openingTag(html, "graph-hud-mode-slot");
    expect(slot).toContain('role="group"');
    expect(slot).not.toContain("hidden");
    const slotAt = html.indexOf('data-testid="graph-hud-mode-slot"');
    for (const id of ["graph-hud-mode-topology", "graph-hud-mode-matrix"]) {
      const at = html.indexOf('data-testid="' + id + '"');
      expect(at).toBeGreaterThan(slotAt);
      expect(openingTag(html, id)).toMatch(/aria-label="[^"]+"/);
    }
    // Topology is the drawn mode by default: its button is the pressed one.
    expect(openingTag(html, "graph-hud-mode-topology")).toContain('aria-pressed="true"');
    expect(openingTag(html, "graph-hud-mode-matrix")).toContain('aria-pressed="false"');
  });

  it("moves the pressed state with the shared view-state mode", () => {
    const html = markup({ mode: "matrix" });
    expect(openingTag(html, "graph-hud-mode-topology")).toContain('aria-pressed="false"');
    expect(openingTag(html, "graph-hud-mode-matrix")).toContain('aria-pressed="true"');
  });
});
