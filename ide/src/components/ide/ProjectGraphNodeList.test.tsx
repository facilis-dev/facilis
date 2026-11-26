// The accessible node list (issue #182): the canvas surface's DOM mirror. ide/ ships no jsdom,
// so the markup is rendered to a string and the click contract is exercised through the
// exported selectListNode helper the buttons call.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale, t } from "@/i18n";
import type { ProjectGraphNode } from "@/facilis/graph-types.ts";
import type { GraphDomain } from "@/facilis/graph-surface/domains.ts";
import { ProjectGraphNodeList, selectListNode } from "./ProjectGraphNodeList";

function page(id: string, label: string): ProjectGraphNode {
  return {
    id,
    kind: "page",
    label,
    sourceFile: null,
    position: { x: 0, y: 0 },
    matched: true,
    collapsed: false,
    data: {
      kind: "page",
      pagePath: label,
      pageKind: "page",
      callCount: 0,
      routePaths: [],
      preview: null,
    },
  };
}

function table(id: string, label: string): ProjectGraphNode {
  return {
    id,
    kind: "table",
    label,
    sourceFile: null,
    position: { x: 0, y: 0 },
    matched: true,
    collapsed: false,
    data: {
      kind: "table",
      table: label,
      columns: [],
      rlsEnabled: true,
      framework: false,
      scope: null,
      policies: [],
      unknown: false,
    },
  };
}

const nodes = [page("page:admin", "/admin"), table("table:users", "users")];
const domains: readonly GraphDomain[] = [{ name: "admin", nodeIds: ["page:admin", "table:users"] }];

function render(props: {
  detailDomain?: string | null;
  onSelectNode?: (id: string) => void;
  onOpenDomain?: (domain: string) => void;
}): string {
  return renderToStaticMarkup(
    <ProjectGraphNodeList
      nodes={nodes}
      domains={domains}
      detailDomain={props.detailDomain ?? null}
      onSelectNode={props.onSelectNode ?? vi.fn()}
      onOpenDomain={props.onOpenDomain ?? vi.fn()}
    />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphNodeList", () => {
  it("renders the legacy per-kind test ids with a label + kind accessible name", () => {
    const html = render({});
    expect(html).toContain('data-testid="project-graph-node-list"');
    expect(html).toContain('data-testid="project-graph-page"');
    expect(html).toContain('data-testid="project-graph-table"');
    expect(html).toContain(t("projectGraph.surface.a11y.label"));
    expect(html).toContain('aria-label="/admin (page)"');
    expect(html).toContain('aria-label="users (table)"');
    expect(html).toContain('role="group"');
    expect(html).toContain("<h2");
  });

  it("labels the groups by domain in the overview and by lane in the detail", () => {
    expect(render({})).toContain(">admin</h2>");
    const detail = render({ detailDomain: "admin" });
    expect(detail).toContain(">Pages</h2>");
    expect(detail).toContain(">Data (tables + views)</h2>");
    expect(detail).not.toContain(">admin</h2>");
  });

  it("selects the node id and opens its domain from the overview", () => {
    const onSelectNode = vi.fn();
    const onOpenDomain = vi.fn();
    selectListNode("page:admin", "admin", null, onSelectNode, onOpenDomain);
    expect(onOpenDomain).toHaveBeenCalledWith("admin");
    expect(onSelectNode).toHaveBeenCalledWith("page:admin");
  });

  it("keeps the current domain in the detail and only selects", () => {
    const onSelectNode = vi.fn();
    const onOpenDomain = vi.fn();
    selectListNode("table:users", "admin", "admin", onSelectNode, onOpenDomain);
    expect(onOpenDomain).not.toHaveBeenCalled();
    expect(onSelectNode).toHaveBeenCalledWith("table:users");
  });
});
