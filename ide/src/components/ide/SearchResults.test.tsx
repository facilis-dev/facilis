// ide/ ships no jsdom or testing-library: the rows are rendered to a static string with
// react-dom/server (the pattern of RecentProjectsRow.test.tsx) and the reveal classes are
// asserted on the markup. Real focus movement is a manual/CDP step (pnpm ide:smoke).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale, t } from "@/i18n";
import type { SearchFileResult } from "@/vv/controller";
import { SearchResults } from "./SearchResults";

const results: SearchFileResult[] = [
  {
    file: "/w/app/src/app.ts",
    root: "/w/app",
    matches: [{ line: 3, column: 8, length: 4, preview: "const demo = 1;" }],
  },
];

function markup(collapsed = new Set<string>()): string {
  return renderToStaticMarkup(
    <SearchResults
      results={results}
      collapsed={collapsed}
      showReplace
      onToggle={vi.fn()}
      onOpenMatch={vi.fn()}
      onReplaceFile={vi.fn()}
      onReplaceMatch={vi.fn()}
      onDismiss={vi.fn()}
    />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("SearchResults", () => {
  it("names the row actions through the catalogue", () => {
    const html = markup();
    expect(html).toContain(`aria-label="${t("search.replaceInFile")}"`);
    expect(html).toContain(`aria-label="${t("search.dismiss")}"`);
    expect(html).toContain(`aria-label="${t("search.replace")}"`);
  });

  it("keeps the file row expandable and reveals its actions on focus", () => {
    const html = markup();
    expect(html).toContain('aria-expanded="true"');
    // Opacity, never display:none: a hidden control can never take focus, so
    // group-focus-within would never fire (issue #215).
    expect(html).not.toContain("group-hover:flex");
    expect(html).toContain("opacity-0");
    expect(html).toContain("transition-opacity");
    expect(html.match(/group-focus-within:opacity-100/g)?.length).toBe(2);
    expect(html.match(/group-hover:opacity-100/g)?.length).toBe(2);
    // The match count steps aside for the actions exactly as it did on hover.
    expect(html).toContain("group-focus-within:hidden");
    expect(html).toContain("group-hover:hidden");
  });

  it("reveals the per-match replace through the named group", () => {
    const html = markup();
    expect(html).toContain("group-focus-within/m:opacity-100");
    expect(html).toContain("group-hover/m:opacity-100");
    expect(html).not.toContain("group-hover/m:flex");
  });

  it("renders no match row for a collapsed file", () => {
    const html = markup(new Set(["/w/app/src/app.ts"]));
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("group/m");
  });
});
