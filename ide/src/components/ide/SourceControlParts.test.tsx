// ide/ ships no jsdom or testing-library: the row's role/name and the reveal classes are
// asserted on the static markup (the pattern of RecentProjectsRow.test.tsx). Real focus
// movement is a manual/CDP step, not something this environment can assert.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale, t } from "@/i18n";
import type { GitChange } from "@/vv/scm-session";
import { Row, Section } from "./SourceControlParts";

const change: GitChange = { path: "src/app.ts", abs: "/w/app/src/app.ts", letter: "M" };

beforeEach(() => {
  initI18n();
  setLocale("en");
});

function row(): string {
  return renderToStaticMarkup(
    <Row ch={change} onOpen={vi.fn()}>
      <button type="button" aria-label={t("scm.stageChanges")}>
        stage
      </button>
    </Row>,
  );
}

describe("SourceControlParts", () => {
  it("makes the change row a named button that opens the diff", () => {
    const html = row();
    expect(html).toContain("<button");
    expect(html).toContain(`aria-label="${t("scm.openDiff")}: src/app.ts"`);
    expect(html).toContain('title="src/app.ts"');
    // The actions used to be display:none until hover; that can never take focus.
    expect(html).not.toContain("group-hover:flex");
  });

  it("reveals the row actions on focus as well as hover", () => {
    const html = row();
    expect(html).toContain("opacity-0");
    expect(html).toContain("transition-opacity");
    expect(html).toContain("group-focus-within:opacity-100");
    expect(html).toContain("group-hover:opacity-100");
  });

  it("reveals the section actions on focus as well as hover", () => {
    const html = renderToStaticMarkup(
      <Section
        title={t("scm.changes")}
        count={1}
        actions={
          <button type="button" aria-label={t("scm.stageAll")}>
            all
          </button>
        }
      />,
    );
    expect(html).toContain("opacity-0");
    expect(html).toContain("group-focus-within:opacity-100");
    expect(html).toContain("group-hover:opacity-100");
    expect(html).not.toContain("group-hover:flex");
  });
});
