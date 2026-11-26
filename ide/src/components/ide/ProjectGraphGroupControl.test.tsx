// Static-render tests for the inspector's feature-group control (issue #194 follow-up): the
// rule and its evidence are visible, existing groups are suggested, and the automatic reset is
// offered only when the node is actually pinned.

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale, t } from "@/i18n";
import type { DomainAssignment } from "@/facilis/graph-surface/domains.ts";
import { ProjectGraphGroupControl } from "./ProjectGraphGroupControl";

function render(assignment: DomainAssignment): string {
  return renderToStaticMarkup(
    <ProjectGraphGroupControl
      nodeId="route:GET /api/auth/login"
      assignment={assignment}
      groups={["auth", "todos"]}
      onSetGroup={vi.fn()}
    />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphGroupControl", () => {
  it("shows the group, the reason and the evidence that chose it", () => {
    const html = render({
      group: "auth",
      reason: "route-path",
      evidence: "/api/auth/login",
    });
    expect(html).toContain('data-testid="project-graph-group-control"');
    expect(html).toContain(t("projectGraph.group.title"));
    expect(html).toContain(">auth<");
    expect(html).toContain(t("projectGraph.group.reason.routePath"));
    expect(html).toContain("/api/auth/login");
    expect(html).toContain('aria-label="' + t("projectGraph.group.label") + '"');
    expect(html).toContain(t("projectGraph.group.apply"));
    expect(html).toContain(t("projectGraph.group.reset"));
    expect(html).toContain('value="auth"');
  });

  it("offers the existing groups as datalist suggestions", () => {
    const html = render({ group: "core", reason: "core", evidence: null });
    expect(html).toContain('value="auth"');
    expect(html).toContain('value="todos"');
    expect(html).toContain(t("projectGraph.group.reason.core"));
  });

  it("enables reset only on a manual override", () => {
    const automatic = render({ group: "auth", reason: "route-path", evidence: "/api/auth/login" });
    expect(automatic).toContain('disabled=""');
    const pinned = render({ group: "auth", reason: "override", evidence: null });
    expect(pinned).toContain(t("projectGraph.group.reason.override"));
    expect(pinned).not.toContain('disabled=""');
  });
});
