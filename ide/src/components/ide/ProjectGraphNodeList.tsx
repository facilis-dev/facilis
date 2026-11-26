// The accessible mirror of the canvas graph (issue #182): one real button per visible node,
// grouped by domain (overview) or lane (drill-down). Visually hidden, so it never affects the
// canvas layout or camera, but present in the DOM and keyboard-navigable for screen readers and
// for the browser smoke gate that used to click the React Flow cards.
//
// The buttons reuse the legacy per-kind test ids. A click mirrors tapping a node: select it and
// open the inspector; from the overview it first drills into the node's domain so the canvas
// actually reveals it.

import { useCallback, useId, useMemo } from "react";
import type { GraphNodeKind } from "@facilis.dev/analyze";
import { t, type MessageKey } from "@/i18n";
import type { GraphNote, ProjectGraphNode } from "@/facilis/graph-types";
import {
  A11Y_NODE_TEST_IDS,
  buildA11yNodeGroups,
  type A11yLane,
  type A11yNodeGroup,
} from "@/facilis/graph-surface/a11y-nodes.ts";
import { domainIndex, type GraphDomain } from "@/facilis/graph-surface/domains.ts";
import { noteTitle } from "@/facilis/graph-surface/notes.ts";

const KIND_LABEL_KEYS: Readonly<Record<GraphNodeKind, MessageKey>> = {
  page: "projectGraph.surface.a11y.kind.page",
  route: "projectGraph.surface.a11y.kind.route",
  table: "projectGraph.surface.a11y.kind.table",
  view: "projectGraph.surface.a11y.kind.view",
  workflow: "projectGraph.surface.a11y.kind.workflow",
};

const LANE_LABEL_KEYS: Readonly<Record<A11yLane, MessageKey>> = {
  page: "projectGraph.surface.lane.page",
  route: "projectGraph.surface.lane.route",
  data: "projectGraph.surface.lane.data",
  workflow: "projectGraph.surface.lane.workflow",
};

/**
 * The click contract in one testable place: from the overview, open the node's domain first so
 * the canvas reveals it, then hand the id to the panel's existing selection handler.
 */
export function selectListNode(
  nodeId: string,
  domain: string | null,
  detailDomain: string | null,
  onSelectNode: (id: string) => void,
  onOpenDomain: (domain: string) => void,
): void {
  if (detailDomain === null && domain !== null) onOpenDomain(domain);
  onSelectNode(nodeId);
}

function groupHeading(group: A11yNodeGroup, tFn: typeof t): string {
  return group.kind === "domain" ? group.label : tFn(LANE_LABEL_KEYS[group.label as A11yLane]);
}

export function ProjectGraphNodeList({
  nodes,
  domains,
  detailDomain,
  notes = [],
  onSelectNode,
  onSelectNote,
  onOpenDomain,
}: {
  nodes: readonly ProjectGraphNode[];
  domains: readonly GraphDomain[];
  /** null in the overview; the open domain in the drill-down. */
  detailDomain: string | null;
  /** The saved annotations, mirrored as buttons so keyboard users can reach them (#194). */
  notes?: readonly GraphNote[];
  onSelectNode: (id: string) => void;
  onSelectNote?: (id: string) => void;
  onOpenDomain: (domain: string) => void;
}) {
  const headingPrefix = useId();
  const groups = useMemo(
    () => buildA11yNodeGroups(nodes, domains, detailDomain),
    [nodes, domains, detailDomain],
  );
  const domainOf = useMemo(() => domainIndex(domains), [domains]);
  const select = useCallback(
    (nodeId: string) => {
      selectListNode(
        nodeId,
        domainOf.get(nodeId) ?? null,
        detailDomain,
        onSelectNode,
        onOpenDomain,
      );
    },
    [domainOf, detailDomain, onSelectNode, onOpenDomain],
  );
  return (
    <section
      className="sr-only"
      aria-label={t("projectGraph.surface.a11y.label")}
      data-testid="project-graph-node-list"
    >
      <p>{t("projectGraph.surface.a11y.hint")}</p>
      {groups.map((group) => {
        const headingId = headingPrefix + "-" + group.key;
        return (
          <div key={group.key} role="group" aria-labelledby={headingId}>
            <h2 id={headingId}>{groupHeading(group, t)}</h2>
            <ul>
              {group.nodes.map((node) => (
                <li key={node.id}>
                  <button
                    type="button"
                    data-testid={A11Y_NODE_TEST_IDS[node.kind]}
                    aria-label={t("projectGraph.surface.a11y.node", {
                      label: node.label,
                      kind: t(KIND_LABEL_KEYS[node.kind]),
                    })}
                    onClick={() => select(node.id)}
                  >
                    {node.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {notes.length > 0 && (
        <div role="group" aria-labelledby={headingPrefix + "-notes"}>
          <h2 id={headingPrefix + "-notes"}>{t("projectGraph.surface.a11y.notes")}</h2>
          <ul>
            {notes.map((note) => {
              const title = noteTitle(note.text) || t("projectGraph.noteEmpty");
              return (
                <li key={note.id}>
                  <button
                    type="button"
                    data-testid="project-graph-note"
                    aria-label={title}
                    onClick={() => onSelectNote?.(note.id)}
                  >
                    {title}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
