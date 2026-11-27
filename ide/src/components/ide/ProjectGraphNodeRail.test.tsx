// The visible keyboard rail (issue #213): the node list is a real listbox with one roving tab
// stop, per-kind test ids and group headings, and the sr-only mirror is gone. ide/ ships no jsdom,
// so the markup is rendered to a string; focus movement itself is a browser/CDP step.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale, t } from "@/i18n";
import type { GraphNote, ProjectGraphNode } from "@/facilis/graph-types.ts";
import type { GraphDomain } from "@/facilis/graph-surface/domains.ts";
import { ProjectGraphNodeRail } from "./ProjectGraphNodeRail";

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
const note: GraphNote = { id: "note:1", x: 0, y: 0, text: "Payment notes" };

function render(
  props: {
    detailDomain?: string | null;
    selectedNodeId?: string | null;
    notes?: readonly GraphNote[];
    onSelectNote?: (id: string) => void;
  } = {},
): string {
  return renderToStaticMarkup(
    <ProjectGraphNodeRail
      nodes={nodes}
      domains={domains}
      detailDomain={props.detailDomain ?? null}
      notes={props.notes}
      selectedNodeId={props.selectedNodeId ?? null}
      onSelectNode={vi.fn()}
      onSelectNote={props.onSelectNote}
      onOpenDomain={vi.fn()}
    />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphNodeRail", () => {
  it("renders a labelled listbox, not an sr-only mirror", () => {
    const html = render();
    expect(html).toContain('data-testid="project-graph-node-list"');
    expect(html).toContain('role="listbox"');
    expect(html).toContain('aria-label="' + t("projectGraph.surface.a11y.label") + '"');
    expect(html).not.toContain('<section class="sr-only"');
  });

  it("starts collapsed behind a visible toggle and keeps the list out of the tab order", () => {
    const html = render();
    expect(html).toContain('data-testid="project-graph-node-list-toggle"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain(
      'data-testid="project-graph-node-list-body" class="hidden min-h-0 flex-col border-t"',
    );
    expect(html).not.toContain('data-testid="project-graph-node-list-body" class="flex');
  });

  it("renders the legacy per-kind test ids with a label + kind accessible name", () => {
    const html = render();
    expect(html).toContain('data-testid="project-graph-page"');
    expect(html).toContain('data-testid="project-graph-table"');
    expect(html).toContain('aria-label="/admin (page)"');
    expect(html).toContain('aria-label="users (table)"');
    expect(html).toContain('role="group"');
    expect(html).toContain("<h2");
  });

  it("gives the node list exactly one roving tab stop and marks the canvas selection", () => {
    const html = render({ selectedNodeId: "table:users" });
    expect(html.match(/tabindex="0"/g)).toHaveLength(1);
    expect(html).toContain('role="option" aria-selected="true" tabindex="0"');
  });

  it("labels the groups by domain in the overview and by lane in the detail", () => {
    expect(render()).toContain(">admin</h2>");
    const detail = render({ detailDomain: "admin" });
    expect(detail).toContain(">Pages</h2>");
    expect(detail).toContain(">Data (tables + views)</h2>");
    expect(detail).not.toContain(">admin</h2>");
  });

  it("lists the saved notes under the nodes", () => {
    const html = render({ notes: [note], onSelectNote: vi.fn() });
    expect(html).toContain('data-testid="project-graph-note"');
    expect(html).toContain('aria-label="Payment notes"');
    expect(html).toContain(t("projectGraph.surface.a11y.notes"));
  });

  it("announces the selected node and omits the notes section when empty", () => {
    const html = render();
    expect(html).toContain('role="status"');
    expect(html).not.toContain('data-testid="project-graph-note"');
  });
});
