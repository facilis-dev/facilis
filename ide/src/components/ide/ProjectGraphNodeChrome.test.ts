// The card frame's channel contract (issue #66): the user focus dims to 12%, edge isolation
// to 10%, a search miss to 40% — the strongest dim wins — and the AI focus outlines in the
// brand role without dimming. Both channels can sit on one card (criterion 5). The contract
// lens (issue #69) adds the audit-filter dim (40%, like a search miss) and the diagnostics
// ring, which shares the single outline channel with the AI focus.
import { describe, expect, it } from "vitest";
import { nodeClass } from "./ProjectGraphNodeChrome";
import { contractRingClass } from "./ProjectGraphContractMarks";
import type { Diagnostic } from "@facilis.dev/analyze";

// selected, matched, dragging, focused (user closure), isolated (edge kinds), aiOutlined,
// auditDimmed (issue #69), diagnosticsRing (issue #69).
const frame = (
  overrides: Partial<{
    selected: boolean;
    matched: boolean;
    dragging: boolean;
    focused: boolean;
    isolated: boolean;
    aiOutlined: boolean;
    auditDimmed: boolean;
    diagnosticsRing: string;
  }> = {},
): string =>
  nodeClass(
    overrides.selected ?? false,
    overrides.matched ?? true,
    overrides.dragging ?? false,
    overrides.focused ?? true,
    overrides.isolated ?? false,
    overrides.aiOutlined ?? false,
    overrides.auditDimmed ?? false,
    overrides.diagnosticsRing ?? "",
  );

const error: Diagnostic = { code: "e", severity: "error", message: "e", source: null };
const warning: Diagnostic = { code: "w", severity: "warning", message: "w", source: null };

describe("nodeClass channels", () => {
  it("draws a plain card with no dim and no outline", () => {
    const cls = frame();
    expect(cls).not.toContain("opacity-");
    expect(cls).not.toContain("outline");
  });

  it("dims a card outside the user's closure to 12%", () => {
    expect(frame({ focused: false })).toContain("opacity-12");
  });

  it("outlines an AI-named card in the brand role without dimming it", () => {
    const cls = frame({ aiOutlined: true });
    expect(cls).toContain("outline-2");
    expect(cls).toContain("outline-brand/70");
    expect(cls).not.toContain("opacity-");
  });

  it("composes: a dimmed card can still carry the AI outline", () => {
    const cls = frame({ focused: false, aiOutlined: true });
    expect(cls).toContain("opacity-12");
    expect(cls).toContain("outline-brand/70");
  });

  it("lets edge isolation (10%) win over the user dim (12%)", () => {
    const cls = frame({ focused: false, isolated: true });
    expect(cls).toContain("opacity-10");
    expect(cls).not.toContain("opacity-12");
  });

  it("keeps the search-miss dim at 40% and lets the stronger user dim win", () => {
    expect(frame({ matched: false })).toContain("opacity-40");
    expect(frame({ matched: false, focused: false })).toContain("opacity-12");
  });

  it("keeps the selection ring under both channels", () => {
    const cls = frame({ selected: true, focused: false, aiOutlined: true });
    expect(cls).toContain("ring-primary");
    expect(cls).toContain("opacity-12");
    expect(cls).toContain("outline-brand/70");
  });
});

describe("nodeClass contract-lens channels (issue #69)", () => {
  it("dims an audit-filter miss to 40%, like a search miss", () => {
    expect(frame({ auditDimmed: true })).toContain("opacity-40");
  });

  it("lets the stronger user and isolation dims win over the audit dim", () => {
    expect(frame({ auditDimmed: true, focused: false })).toContain("opacity-12");
    expect(frame({ auditDimmed: true, isolated: true })).toContain("opacity-10");
    expect(frame({ auditDimmed: true, focused: false })).not.toContain("opacity-40");
  });

  it("draws the diagnostics ring in the severity role, error beating warning", () => {
    expect(frame({ diagnosticsRing: contractRingClass([warning]) })).toContain(
      "outline-warning/70",
    );
    expect(frame({ diagnosticsRing: contractRingClass([warning, error]) })).toContain(
      "outline-destructive/70",
    );
    expect(frame({ diagnosticsRing: contractRingClass([]) })).not.toContain("outline");
  });

  it("lets the AI outline win the single outline channel; the badge keeps the severity", () => {
    const cls = frame({ aiOutlined: true, diagnosticsRing: contractRingClass([error]) });
    expect(cls).toContain("outline-brand/70");
    expect(cls).not.toContain("outline-destructive/70");
    // The AI outline never dims, even on an audit-filtered card.
    expect(frame({ aiOutlined: true, auditDimmed: true })).toContain("opacity-40");
    expect(frame({ aiOutlined: true, auditDimmed: true })).toContain("outline-brand/70");
  });
});
