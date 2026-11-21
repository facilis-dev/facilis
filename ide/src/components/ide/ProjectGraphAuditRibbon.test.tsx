// The audit ribbon's rendered contract (issue #69), as static markup (the ide/ pattern: no
// jsdom): four named filter counters with their counts and pressed states. The toggle semantics
// live in graph-contract.test.ts; the browser gate proves the click-to-filter interaction.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale } from "@/i18n";
import { AUDIT_FILTER_IDS, type AuditCounts, type AuditFilterId } from "@/facilis/graph-contract";
import { ProjectGraphAuditRibbon } from "./ProjectGraphAuditRibbon";

const counts: AuditCounts = { protected: 3, missingInput: 2, unknown: 1, diagnostics: 4 };

function markup(filters: readonly AuditFilterId[] = [], disabled = false): string {
  return renderToStaticMarkup(
    <ProjectGraphAuditRibbon
      counts={counts}
      filters={filters}
      onToggle={vi.fn()}
      disabled={disabled}
    />,
  );
}

function button(html: string, id: AuditFilterId): string {
  const start = html.indexOf('data-testid="graph-audit-' + id + '"');
  expect(start).toBeGreaterThanOrEqual(0);
  const slice = html.slice(start);
  return slice.slice(0, slice.indexOf("</button>"));
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphAuditRibbon", () => {
  it("renders the four counters as a named toolbar, each with its count", () => {
    const html = markup();
    expect(html).toContain('role="toolbar"');
    expect(html).toContain("Contract audit");
    for (const id of AUDIT_FILTER_IDS) {
      expect(html).toContain('data-testid="graph-audit-' + id + '"');
    }
    expect(button(html, "protected")).toContain(">3<");
    expect(button(html, "missingInput")).toContain(">2<");
    expect(button(html, "unknown")).toContain(">1<");
    expect(button(html, "diagnostics")).toContain(">4<");
  });

  it("announces the pressed state of the active filters only", () => {
    const html = markup(["unknown", "diagnostics"]);
    expect(button(html, "unknown")).toContain('aria-pressed="true"');
    expect(button(html, "diagnostics")).toContain('aria-pressed="true"');
    expect(button(html, "protected")).toContain('aria-pressed="false"');
    expect(button(html, "missingInput")).toContain('aria-pressed="false"');
  });

  it("names every counter with a glyph and a label, never colour alone", () => {
    const html = markup();
    for (const id of AUDIT_FILTER_IDS) {
      const chip = button(html, id);
      expect(chip).toContain("<svg");
      expect(chip).toContain("aria-label=");
      expect(chip).toContain("title=");
    }
    expect(html).toContain("Protected");
    expect(html).toContain("No input");
    expect(html).toContain("Unknown");
    expect(html).toContain("Diagnostics");
  });

  it("disables with the HUD when no analysis is loaded", () => {
    expect(markup([], true)).toContain('disabled=""');
    expect(markup([], false)).not.toContain('disabled=""');
  });

  it("speaks Italian when the locale is it", () => {
    setLocale("it");
    const html = markup(["protected"]);
    expect(html).toContain("Audit del contratto");
    expect(html).toContain("Protette");
    expect(html).toContain("Senza input");
    expect(button(html, "protected")).toContain('aria-pressed="true"');
  });
});
