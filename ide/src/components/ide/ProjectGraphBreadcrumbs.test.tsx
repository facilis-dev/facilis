// The breadcrumbs' rendered contract (issue #68 criterion 5), as static markup (the ide/
// pattern: no jsdom). The trail data and the Esc composition live in graph-navigation.test.ts
// and graph-user-focus.test.ts; the browser gate proves the click-through. Here: the project →
// cluster → node trail, named buttons, aria-current and the Italian labels.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { initI18n, setLocale } from "@/i18n";
import { OTHER_CLUSTER_KEY } from "@/facilis/graph-clusters";
import { buildGraphBreadcrumbs } from "@/facilis/graph-navigation";
import { ProjectGraphBreadcrumbs } from "./ProjectGraphBreadcrumbs";

function markup(
  selected: { id: string; label: string } | null,
  cluster: { id: string; label: string } | null = null,
): string {
  return renderToStaticMarkup(
    <ProjectGraphBreadcrumbs
      trail={buildGraphBreadcrumbs(selected, cluster)}
      onNavigate={vi.fn()}
    />,
  );
}

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("ProjectGraphBreadcrumbs", () => {
  it("renders the project root alone with no selection", () => {
    const html = markup(null);
    expect(html).toContain('data-testid="graph-breadcrumbs"');
    expect(html).toContain('data-testid="graph-breadcrumb-project"');
    expect(html).not.toContain('data-testid="graph-breadcrumb-node"');
    expect(html).toContain("Project graph");
    expect(html).toContain("Return to the project overview");
  });

  it("renders project → node with a named zoom button on the node", () => {
    const html = markup({ id: "table:todos", label: "todos" });
    expect(html).toContain('data-testid="graph-breadcrumb-project"');
    expect(html).toContain('data-testid="graph-breadcrumb-node"');
    expect(html).toContain("Zoom to todos");
    expect(html).toContain(">todos<");
    // The separator between the two levels.
    expect(html).toContain("›");
  });

  it("marks the deepest level as the current location", () => {
    const html = markup({ id: "table:todos", label: "todos" });
    const node = html.slice(html.indexOf('data-testid="graph-breadcrumb-node"'));
    expect(node.slice(0, node.indexOf("</button>"))).toContain('aria-current="location"');
    const root = html.slice(html.indexOf('data-testid="graph-breadcrumb-project"'));
    expect(root.slice(0, root.indexOf("</button>"))).not.toContain("aria-current");
  });

  it("fills the #62 cluster slot between the project root and the node", () => {
    const html = markup(
      { id: "table:todos", label: "todos" },
      { id: "cluster:todos", label: "todos" },
    );
    expect(html).toContain('data-testid="graph-breadcrumb-project"');
    expect(html).toContain('data-testid="graph-breadcrumb-cluster"');
    expect(html).toContain('data-testid="graph-breadcrumb-node"');
    expect(html).toContain("Focus the todos cluster");
    // The deepest level is the current location, exactly once.
    expect((html.match(/aria-current="location"/g) ?? []).length).toBe(1);
  });

  it("names the ungrouped bucket as Other instead of the raw key", () => {
    const html = markup(null, { id: "cluster:other", label: OTHER_CLUSTER_KEY });
    expect(html).toContain(">Other<");
    expect(html).not.toContain(">" + OTHER_CLUSTER_KEY + "<");
  });

  it("is a named navigation landmark", () => {
    expect(markup(null)).toContain('aria-label="Graph location"');
  });

  it("speaks Italian when the locale is it", () => {
    setLocale("it");
    const html = markup({ id: "table:todos", label: "todos" });
    expect(html).toContain("Posizione nel grafo");
    expect(html).toContain("Zooma su todos");
    expect(html).toContain("Torna alla panoramica del progetto");
  });
});
