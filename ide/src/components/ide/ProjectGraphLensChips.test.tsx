// The chips' rendered contract (issue #63), as static markup (the ide/ pattern: no jsdom).
// The click/key semantics live in graph-lens-state.test.ts; the browser gate proves the
// interaction. Here: the legend, the state badges, the roving tabindex and the collapse button.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale } from "@/i18n";
import type { GraphEdgeKind } from "@facilis.dev/analyze";
import { GRAPH_EDGE_KINDS } from "@/facilis/graph-types";
import { GRAPH_LENS_IDS } from "@/facilis/graph-view-state";
import { countEdgeKinds } from "@/facilis/graph-lens-state";
import { ProjectGraphLensChips } from "./ProjectGraphLensChips";

const counts = countEdgeKinds([{ kind: "fk" }, { kind: "fk" }, { kind: "relation" }]);

function markup(
  overrides: {
    hiddenEdgeKinds?: readonly GraphEdgeKind[];
    isolatedEdgeKinds?: readonly GraphEdgeKind[];
    activeLenses?: readonly (typeof GRAPH_LENS_IDS)[number][];
    disabled?: boolean;
  } = {},
): string {
  return renderToStaticMarkup(
    <ProjectGraphLensChips
      disabled={overrides.disabled ?? false}
      edgeCounts={counts}
      hiddenEdgeKinds={overrides.hiddenEdgeKinds ?? []}
      isolatedEdgeKinds={overrides.isolatedEdgeKinds ?? []}
      onIsolatedEdgeKindsChange={vi.fn()}
      onHideEdgeKind={vi.fn()}
      activeLenses={overrides.activeLenses ?? []}
      onActiveLensesChange={vi.fn()}
    />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphLensChips", () => {
  it("renders one chip per edge kind and per registered lens, as a named toolbar", () => {
    const html = markup();
    for (const kind of GRAPH_EDGE_KINDS) {
      expect(html).toContain('data-testid="graph-chip-edge-' + kind + '"');
    }
    for (const id of GRAPH_LENS_IDS) {
      expect(html).toContain('data-testid="graph-chip-lens-' + id + '"');
    }
    expect(html).toContain('role="toolbar"');
    expect(html).toContain("Lenses and edge kinds");
  });

  it("announces the count and the pressed state on the chips", () => {
    const html = markup({ isolatedEdgeKinds: ["fk"] });
    const fk = html.slice(html.indexOf('data-testid="graph-chip-edge-fk"'));
    const chip = fk.slice(0, fk.indexOf("</button>"));
    expect(chip).toContain('aria-pressed="true"');
    expect(chip).toContain(">2<");
    const relation = html.slice(html.indexOf('data-testid="graph-chip-edge-relation"'));
    expect(relation.slice(0, relation.indexOf("</button>"))).toContain('aria-pressed="false"');
  });

  it("marks a hidden kind with a badge while keeping its count", () => {
    const html = markup({ hiddenEdgeKinds: ["relation"] });
    const relation = html.slice(html.indexOf('data-testid="graph-chip-edge-relation"'));
    const chip = relation.slice(0, relation.indexOf("</button>"));
    expect(chip).toContain("hidden");
    expect(chip).toContain(">1<");
  });

  it("marks the dominant lens pressed and the secondary with a badge", () => {
    const html = markup({ activeLenses: ["data", "contract"] });
    const data = html.slice(html.indexOf('data-testid="graph-chip-lens-data"'));
    expect(data.slice(0, data.indexOf("</button>"))).toContain('aria-pressed="true"');
    const contract = html.slice(html.indexOf('data-testid="graph-chip-lens-contract"'));
    const chip = contract.slice(0, contract.indexOf("</button>"));
    expect(chip).toContain('aria-pressed="true"');
    expect(chip).toContain("secondary");
    const agent = html.slice(html.indexOf('data-testid="graph-chip-lens-agent"'));
    expect(agent.slice(0, agent.indexOf("</button>"))).toContain('aria-pressed="false"');
  });

  it("uses a roving tabindex: one tab stop among the chips, the rest reachable by arrows", () => {
    const html = markup();
    // The collapse button is a separate tab stop; the roving pattern owns the chips only.
    const stops = html.match(/data-graph-chip[^>]*tabindex="0"/g) ?? [];
    const rest = html.match(/data-graph-chip[^>]*tabindex="-1"/g) ?? [];
    expect(stops).toHaveLength(1);
    expect(rest).toHaveLength(GRAPH_EDGE_KINDS.length + GRAPH_LENS_IDS.length - 1);
  });

  it("ships the narrow-width collapse button and disables with the HUD", () => {
    const html = markup();
    expect(html).toContain('data-testid="graph-lens-collapse"');
    expect(html).toContain('aria-expanded="false"');
    expect(markup({ disabled: true })).toContain("disabled");
  });

  it("speaks Italian when the locale is it", () => {
    setLocale("it");
    const html = markup({ activeLenses: ["data", "contract"] });
    expect(html).toContain("Contratto");
    expect(html).toContain("secondaria");
    expect(html).toContain("Lenti");
  });
});
