// The turn-diff ribbon's rendered contract (issue #73), as static markup (the ide/ pattern:
// no jsdom). The diff derivation lives in graph-turn-diff.test.ts; the browser gate proves the
// wiring. Here: counters, base ref, the unmapped disclosure, the clean state, secondary fade.
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale } from "@/i18n";
import { INACTIVE_TURN_DIFF, type GraphTurnDiff } from "@/facilis/graph-turn-diff";
import { ProjectGraphTurnRibbon } from "./ProjectGraphTurnRibbon";

const ACTIVE: GraphTurnDiff = {
  ...INACTIVE_TURN_DIFF,
  active: true,
  counts: { changed: 1, added: 2, deleted: 3 },
  unmapped: ["README.md", "docs/notes.md"],
};

function markup(diff: GraphTurnDiff, secondary = false, ready = true): string {
  return renderToStaticMarkup(
    <ProjectGraphTurnRibbon diff={diff} secondary={secondary} ready={ready} />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphTurnRibbon", () => {
  it("shows the counters, the base ref and the unmapped disclosure when active", () => {
    const html = markup(ACTIVE);
    expect(html).toContain('data-testid="graph-turn-ribbon"');
    expect(html).toContain("Turn diff");
    expect(html).toContain(">1<");
    expect(html).toContain(">2<");
    expect(html).toContain(">3<");
    expect(html).toContain("base HEAD");
    expect(html).toContain('data-testid="graph-turn-unmapped"');
    expect(html).toContain("2 not on the graph");
    expect(html).toContain('aria-expanded="false"');
    // The full list is reachable through the disclosure, never a side panel.
    expect(html).not.toContain('data-testid="graph-turn-unmapped-list"');
  });

  it("shows an explicit clean state instead of silently disappearing", () => {
    const html = markup(INACTIVE_TURN_DIFF);
    expect(html).toContain('data-testid="graph-turn-clean"');
    expect(html).toContain("Clean tree");
    expect(html).not.toContain('data-testid="graph-turn-unmapped"');
  });

  it("names the missing checkpoint instead of guessing a clean tree (epic rule 5)", () => {
    const html = markup(INACTIVE_TURN_DIFF, false, false);
    expect(html).toContain('data-testid="graph-turn-nogit"');
    expect(html).toContain("No git checkpoint");
    expect(html).not.toContain('data-testid="graph-turn-clean"');
  });

  it("fades to ~30% when the agent lens is secondary (epic rule 3)", () => {
    expect(markup(ACTIVE, true)).toContain("opacity-30");
    expect(markup(ACTIVE, false)).not.toContain("opacity-30");
  });

  it("names every counter for assistive tech, not by colour alone", () => {
    const html = markup(ACTIVE);
    expect(html).toContain('aria-label="1 changed"');
    expect(html).toContain('aria-label="2 added"');
    expect(html).toContain('aria-label="3 deleted"');
  });
});
