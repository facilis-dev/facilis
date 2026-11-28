// Static-render tests for the graph's declared-surface badge (D-226, #235): the counts come
// from the dev endpoint, green means nothing undeclared/unknown remains, and an unavailable
// endpoint renders no chrome at all.

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { initI18n, setLocale, t } from "@/i18n";
import type { SecuritySurfaceSummary } from "@/facilis/security-surface-client";
import { SecuritySurfaceBadgeView, isSurfaceClean } from "./SecuritySurfaceBadgeView";

const CLEAN: SecuritySurfaceSummary = { standard: 4, declared: 2, undeclared: 0, unknown: 0 };
const FLAGGED: SecuritySurfaceSummary = { standard: 4, declared: 2, undeclared: 1, unknown: 3 };

function render(summary: SecuritySurfaceSummary | null): string {
  return renderToStaticMarkup(<SecuritySurfaceBadgeView summary={summary} onDownload={vi.fn()} />);
}

beforeAll(() => {
  initI18n();
  setLocale("en");
});

describe("isSurfaceClean", () => {
  it("is green only when nothing is undeclared and nothing is unknown", () => {
    expect(isSurfaceClean(CLEAN)).toBe(true);
    expect(isSurfaceClean({ ...CLEAN, undeclared: 1 })).toBe(false);
    expect(isSurfaceClean({ ...CLEAN, unknown: 1 })).toBe(false);
  });
});

describe("SecuritySurfaceBadgeView", () => {
  it("renders the declared, undeclared and unknown counts", () => {
    const html = render(FLAGGED);
    expect(html).toContain(
      t("projectGraph.surface.security.badge", {
        declared: FLAGGED.declared,
        undeclared: FLAGGED.undeclared,
        unknown: FLAGGED.unknown,
      }),
    );
    expect(html).toContain("2 declared");
    expect(html).toContain("1 undeclared");
    expect(html).toContain("3 unknown");
    expect(html).toContain(t("projectGraph.surface.security.tooltip", { ...FLAGGED }));
    expect(html).toContain('aria-label="' + t("projectGraph.surface.security.download") + '"');
  });

  it("is green with no undeclared and no unknown entry, and warning otherwise", () => {
    expect(render(CLEAN)).toContain("text-success");
    expect(render(CLEAN)).not.toContain("text-warning");
    expect(render(FLAGGED)).toContain("text-warning");
    expect(render(FLAGGED)).not.toContain("text-success");
  });

  it("renders nothing while the endpoint is unavailable", () => {
    expect(render(null)).toBe("");
  });

  it("disables the download while one is running", () => {
    const html = renderToStaticMarkup(
      <SecuritySurfaceBadgeView summary={CLEAN} busy onDownload={vi.fn()} />,
    );
    expect(html).toContain("disabled");
  });
});
