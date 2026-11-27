// Static-render tests for the lens picker (issue #204): the list is the registry, every row
// carries its title, description and digit, and the unavailable runtime lens is disabled with
// its translated reason. Interaction is covered by the pure command/guard tests and the smoke.

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@/i18n";
import { GRAPH_LENSES } from "@/facilis/graph-surface/lenses-registry.ts";
import { GraphLensPicker } from "./GraphLensPicker";
import type { GraphLensCommandController } from "./graph-lens-commands";

const CONTROLLER = {
  bridge: {},
  preview: { activePreviewTab: () => null },
  openProjectGraph: () => {},
} as unknown as GraphLensCommandController;

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("GraphLensPicker", () => {
  it("lists every registry lens with its title, description and digit", () => {
    const html = renderToStaticMarkup(
      <GraphLensPicker open onClose={vi.fn()} controller={CONTROLLER} />,
    );
    expect(html).toContain("Lens picker");
    expect(html).toContain("1–" + GRAPH_LENSES.length + " picks a lens");
    expect(html).toContain("Q5 · Security");
    expect(html).toContain("Q21 · Prerender");
    expect(html).toContain('data-testid="graph-lens-picker-security"');
    expect(html).toContain("⌘⇧L 1");
  });

  it("disables an unavailable lens and shows its translated reason", () => {
    const html = renderToStaticMarkup(
      <GraphLensPicker open onClose={vi.fn()} controller={CONTROLLER} />,
    );
    expect(html).toContain("Project not running");
  });

  it("renders nothing while closed", () => {
    expect(
      renderToStaticMarkup(
        <GraphLensPicker open={false} onClose={vi.fn()} controller={CONTROLLER} />,
      ),
    ).toBe("");
  });
});
