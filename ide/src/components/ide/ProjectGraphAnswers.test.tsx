// Static-render tests for the inspector's answer sections (issue #190): the header counts,
// the capped list with "+N more", the explicit per-section empty state and the shared Q4/Q17
// lens labels. ide/ ships no jsdom, so this renders to a string like the other UI tests.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale, t } from "@/i18n";
import type { NodeDetails } from "@/facilis/graph-details";
import type {
  ProjectGraphNode,
  ProjectGraphStats,
  ProjectGraphView,
  TableGraphData,
} from "@/facilis/graph-model";
import { ProjectGraphAnswers } from "./ProjectGraphAnswers";

const SOURCE = { file: "db/schema.ts", line: 7 };

const policies = Array.from({ length: 7 }, (_, index) => ({
  name: "policy_" + index,
  restrictive: index % 2 === 0,
}));

const table: ProjectGraphNode = {
  id: "table:todos",
  kind: "table",
  label: "todos",
  sourceFile: "db/schema.ts",
  position: { x: 0, y: 0 },
  matched: true,
  collapsed: false,
  data: {
    kind: "table",
    table: "todos",
    columns: [],
    rlsEnabled: true,
    framework: false,
    scope: null,
    policies,
    unknown: false,
  } satisfies TableGraphData,
};

const stats: ProjectGraphStats = {
  pages: 0,
  routes: 0,
  tables: 1,
  views: 0,
  workflows: 0,
  edges: 0,
  hiddenEdges: 0,
  hiddenNodes: 0,
  matches: 1,
  unknownNodes: 0,
  pageLinks: 0,
  elevatedEdges: 0,
};

const view: ProjectGraphView = { nodes: [table], edges: [], stats };

const details: ReadonlyMap<string, NodeDetails> = new Map([
  [
    table.id,
    {
      kind: "table",
      table: {
        source: SOURCE,
        columns: [],
        policies: policies.map((policy) => ({
          name: policy.name,
          command: "SELECT",
          restrictive: policy.restrictive,
        })),
        foreignKeys: [],
        relations: [],
      },
    },
  ],
]);

beforeEach(() => {
  initI18n();
  setLocale("en");
});

describe("project graph answer sections", () => {
  it("renders the table questions with counts, capped rows and explicit empty states", () => {
    const html = renderToStaticMarkup(
      <ProjectGraphAnswers
        node={table}
        view={view}
        details={details}
        diagnostics={[]}
        onNavigateNode={vi.fn()}
        onOpenFileAt={vi.fn()}
      />,
    );
    expect(html).toContain(t("projectGraph.surface.answers.title"));
    expect(html).toContain(t("projectGraph.surface.answers.q5"));
    expect(html).toContain(t("projectGraph.surface.answers.q7"));
    expect(html).toContain(t("projectGraph.surface.answers.empty.q7"));
    expect(html).toContain(t("projectGraph.surface.answers.q16"));
    expect(html).toContain(SOURCE.file);
    expect(html).toContain(t("projectGraph.surface.answers.rls.enabled"));
    expect(html).toContain(t("projectGraph.surface.answers.more", { count: 2 }));
    expect(html).toContain("policy_0");
    expect(html).toContain(t("projectGraph.surface.lens.unknown"));
  });

  it("keeps the node-data policies when analysis details are missing", () => {
    const html = renderToStaticMarkup(
      <ProjectGraphAnswers
        node={table}
        view={view}
        details={new Map()}
        diagnostics={[]}
        onNavigateNode={vi.fn()}
        onOpenFileAt={vi.fn()}
      />,
    );
    // Without details the table still lists its node data policies (seven rows): the cap stays.
    expect(html).toContain(t("projectGraph.surface.answers.more", { count: 2 }));
  });
});
