// ide/ ships no jsdom or testing-library: the busy row is rendered to a static string
// with react-dom/server (the pattern of chat-markdown.test.tsx). The stateful wrapper
// needs the IDE context, so the presentational view carries the opening flag.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale, t } from "@/i18n";
import type { ProjectMeta } from "@/vv/controller";
import { RecentProjectsRowView } from "./RecentProjectsRow";

const project: ProjectMeta = {
  rootPath: "/w/demo",
  template: "facilis",
  createdAt: 0,
  lastModified: Date.now(),
};

function markup(opening: boolean): string {
  return renderToStaticMarkup(
    <RecentProjectsRowView
      project={project}
      opening={opening}
      onOpen={vi.fn()}
      onOpenInNewTab={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("RecentProjectsRowView", () => {
  it("is interactive when no open is pending", () => {
    const html = markup(false);
    expect(html).not.toContain('disabled=""');
    expect(html).not.toContain('aria-busy="true"');
    expect(html).not.toContain("animate-spin");
    expect(html).toContain("demo");
    expect(html).toContain("/w/demo");
  });

  it("is busy and non-interactive while an open is pending", () => {
    const html = markup(true);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("animate-spin");
    expect(html).toContain(t("recent.opening"));
    // The main open button plus the new-tab and delete buttons: the whole row is locked.
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });
});
