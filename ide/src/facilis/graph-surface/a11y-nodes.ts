// The accessibility layer of the canvas graph (issue #182): a Canvas2D surface has no DOM
// semantics, so the same visible nodes are mirrored as a stable, grouped list of buttons.
// Pure: the builder takes the filtered view model and the domains, so the list always matches
// what the canvas draws (hidden tables are already absent from view.nodes) without per-frame
// React work. The component only adds i18n and the click wiring.

import type { GraphNodeKind } from "@facilis.dev/analyze";
import type { ProjectGraphNode } from "../graph-types.ts";
import type { GraphDomain } from "./domains.ts";

/** Lanes in the order the detail canvas draws them; data merges tables and views. */
export type A11yLane = "page" | "route" | "data" | "workflow";

export interface A11yNodeGroup {
  readonly key: string;
  /** "domain" in the overview (one group per map card), "lane" in the drill-down. */
  readonly kind: "domain" | "lane";
  /** The domain name for a domain group, the lane id for a lane group. */
  readonly label: string;
  readonly nodes: readonly ProjectGraphNode[];
}

/** Stable per-kind test ids: the legacy React Flow cards exposed exactly these hooks. */
export const A11Y_NODE_TEST_IDS: Readonly<Record<GraphNodeKind, string>> = {
  page: "project-graph-page",
  route: "project-graph-route",
  table: "project-graph-table",
  view: "project-graph-view",
  workflow: "project-graph-workflow",
};

/** The lane that owns each kind; tables and views share the data lane (as on the canvas). */
const LANE_OF_KIND: Readonly<Record<GraphNodeKind, A11yLane>> = {
  page: "page",
  route: "route",
  table: "data",
  view: "data",
  workflow: "workflow",
};

const LANE_ORDER: readonly A11yLane[] = ["page", "route", "data", "workflow"];
const KIND_ORDER: readonly GraphNodeKind[] = ["page", "route", "table", "view", "workflow"];

function compareNodes(a: ProjectGraphNode, b: ProjectGraphNode): number {
  const byKind = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
  if (byKind !== 0) return byKind;
  const byLabel = a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
  if (byLabel !== 0) return byLabel;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function group(key: string, kind: A11yNodeGroup["kind"], label: string, nodes: ProjectGraphNode[]) {
  return { key, kind, label, nodes: nodes.toSorted(compareNodes) };
}

/**
 * The groups the a11y list renders. With `detailDomain === null` the overview is on screen:
 * every visible node belongs to a domain card, so the list groups by domain (the same order as
 * deriveDomains). In the drill-down only the open domain's nodes are visible, grouped by lane.
 * Empty groups are dropped so the list has no headings without entries.
 */
export function buildA11yNodeGroups(
  nodes: readonly ProjectGraphNode[],
  domains: readonly GraphDomain[],
  detailDomain: string | null,
): readonly A11yNodeGroup[] {
  if (detailDomain === null) {
    const byId = new Map(nodes.map((node) => [node.id, node] as const));
    return domains.flatMap((domain) => {
      const members = domain.nodeIds.flatMap((id) => {
        const node = byId.get(id);
        return node === undefined ? [] : [node];
      });
      return members.length === 0
        ? []
        : [group("domain:" + domain.name, "domain", domain.name, members)];
    });
  }
  const lanes = new Map<A11yLane, ProjectGraphNode[]>();
  const domainOf = new Map<string, string>();
  for (const domain of domains) {
    for (const id of domain.nodeIds) domainOf.set(id, domain.name);
  }
  for (const node of nodes) {
    if (domainOf.get(node.id) !== detailDomain) continue;
    const lane = LANE_OF_KIND[node.kind];
    const members = lanes.get(lane);
    if (members === undefined) lanes.set(lane, [node]);
    else members.push(node);
  }
  return LANE_ORDER.flatMap((lane) => {
    const members = lanes.get(lane);
    return members === undefined || members.length === 0
      ? []
      : [group("lane:" + lane, "lane", lane, members)];
  });
}
