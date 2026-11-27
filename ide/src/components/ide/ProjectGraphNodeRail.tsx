// The visible keyboard path into the project graph (issue #213): the nodes are canvas paint, so
// there is no DOM node to focus and the old sr-only mirror received focus inside clipped content.
// This rail is that mirror made real: a labelled listbox with one roving tab index, arrows/Home/End
// moving the active node, Enter choosing it (drilling into its domain from the overview first,
// exactly like a canvas click) and Escape left to the graph's single ladder. It starts collapsed as
// a visible "Nodes" control, so it never covers the canvas or steals a pointer until asked, and the
// list stays in the DOM so the pointer smoke gate can still activate the legacy per-kind hooks.

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import PanelLeft from "~icons/lucide/panel-left";
import { t, type MessageKey } from "@/i18n";
import type { GraphNodeKind } from "@facilis.dev/analyze";
import type { GraphNote, ProjectGraphNode } from "@/facilis/graph-types";
import {
  A11Y_NODE_TEST_IDS,
  buildA11yNodeGroups,
  type A11yLane,
  type A11yNodeGroup,
} from "@/facilis/graph-surface/a11y-nodes.ts";
import { domainIndex, type GraphDomain } from "@/facilis/graph-surface/domains.ts";
import { noteTitle } from "@/facilis/graph-surface/notes.ts";
import {
  activeNodeOption,
  buildNodeListOptions,
  nodeListIntent,
  nodeListOptionAttributes,
  selectListNode,
} from "@/facilis/graph-surface/node-list-model.ts";

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

function groupHeading(group: A11yNodeGroup): string {
  return group.kind === "domain" ? group.label : t(LANE_LABEL_KEYS[group.label as A11yLane]);
}

function optionClass(isActive: boolean, isSelected: boolean): string {
  return (
    "flex w-full items-center gap-2 rounded border px-2 py-1 text-left text-[11px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 " +
    (isSelected
      ? "border-primary bg-primary/10"
      : "border-transparent " + (isActive ? "bg-accent/10" : "hover:bg-accent/10"))
  );
}

export function ProjectGraphNodeRail({
  nodes,
  domains,
  detailDomain,
  notes = [],
  selectedNodeId,
  onSelectNode,
  onSelectNote,
  onOpenDomain,
}: {
  nodes: readonly ProjectGraphNode[];
  domains: readonly GraphDomain[];
  /** null in the overview; the open domain in the drill-down. */
  detailDomain: string | null;
  /** The saved annotations, listed under the nodes so keyboard users can reach them (#194). */
  notes?: readonly GraphNote[];
  /** The canvas selection: the rail's roving stop and highlight follow it. */
  selectedNodeId: string | null;
  onSelectNode: (id: string) => void;
  onSelectNote?: (id: string) => void;
  onOpenDomain: (domain: string) => void;
}) {
  const headingPrefix = useId();
  const listId = useId();
  const hintId = useId();
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const focusOnOpen = useRef(false);
  const options = useRef(new Map<string, HTMLButtonElement>());
  const groups = useMemo(
    () => buildA11yNodeGroups(nodes, domains, detailDomain),
    [nodes, domains, detailDomain],
  );
  const optionsList = useMemo(() => buildNodeListOptions(groups), [groups]);
  const active = activeNodeOption(optionsList, activeId ?? selectedNodeId);
  const selected = optionsList.find((option) => option.id === selectedNodeId) ?? null;
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
  // A canvas click selects a node without touching the rail: move the roving stop onto it so Tab
  // back into the rail lands where the canvas ring already is.
  useEffect(() => {
    if (selectedNodeId === null) return;
    setActiveId((current) => (current === selectedNodeId ? current : selectedNodeId));
  }, [selectedNodeId]);
  // Opening from the toggle hands the keyboard straight to the active node: one Tab to the rail,
  // Enter to open it, arrows from there.
  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    const id = active?.id;
    if (id !== undefined) options.current.get(id)?.focus();
  }, [open, active]);
  const toggleOpen = () => {
    if (!open) focusOnOpen.current = true;
    setOpen(!open);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const intent = nodeListIntent(optionsList, active?.id ?? null, event);
    if (intent === null) return;
    event.preventDefault();
    if (intent.kind === "select") {
      select(intent.id);
      return;
    }
    setActiveId(intent.id);
    options.current.get(intent.id)?.focus();
  };
  const noteHeadingId = headingPrefix + "-notes";
  return (
    <div
      data-testid="project-graph-node-rail"
      className={
        "absolute bottom-9 left-2 z-10 flex max-h-[calc(100%-5rem)] flex-col overflow-hidden rounded-lg border bg-panel shadow-lg " +
        (open ? "w-64" : "w-auto")
      }
    >
      <button
        type="button"
        data-testid="project-graph-node-list-toggle"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={t(open ? "projectGraph.nodeList.hide" : "projectGraph.nodeList.show")}
        onClick={toggleOpen}
        className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <PanelLeft className="size-3 shrink-0" />
        <span>{t("projectGraph.nodeList.title")}</span>
        <span className="ml-auto rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground">
          {t("projectGraph.surface.nodeCount", { count: optionsList.length })}
        </span>
      </button>
      <div
        data-testid="project-graph-node-list-body"
        className={(open ? "flex" : "hidden") + " min-h-0 flex-col border-t"}
      >
        <div
          id={listId}
          role="listbox"
          aria-label={t("projectGraph.surface.a11y.label")}
          aria-describedby={hintId}
          data-testid="project-graph-node-list"
          onKeyDown={onKeyDown}
          className="min-h-0 overflow-y-auto p-1"
        >
          {groups.length === 0 ? (
            <p className="px-2 py-1 text-[11px] text-muted-foreground">
              {t("projectGraph.nodeList.empty")}
            </p>
          ) : (
            groups.map((group) => {
              const headingId = headingPrefix + "-" + group.key;
              return (
                <div key={group.key} role="group" aria-labelledby={headingId}>
                  <h2
                    id={headingId}
                    className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {groupHeading(group)}
                  </h2>
                  {group.nodes.map((node) => {
                    const isActive = active?.id === node.id;
                    const isSelected = selectedNodeId === node.id;
                    return (
                      <button
                        key={node.id}
                        ref={(element) => {
                          if (element === null) options.current.delete(node.id);
                          else options.current.set(node.id, element);
                        }}
                        type="button"
                        {...nodeListOptionAttributes(isActive, isSelected)}
                        data-testid={A11Y_NODE_TEST_IDS[node.kind]}
                        aria-label={t("projectGraph.surface.a11y.node", {
                          label: node.label,
                          kind: t(KIND_LABEL_KEYS[node.kind]),
                        })}
                        onFocus={() => setActiveId(node.id)}
                        onClick={() => {
                          setActiveId(node.id);
                          select(node.id);
                        }}
                        className={optionClass(isActive, isSelected)}
                      >
                        <span className="min-w-0 flex-1 truncate">{node.label}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {t(KIND_LABEL_KEYS[node.kind])}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
        {notes.length > 0 && (
          <section aria-labelledby={noteHeadingId} className="min-h-0 overflow-y-auto border-t p-1">
            <h2
              id={noteHeadingId}
              className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {t("projectGraph.surface.a11y.notes")}
            </h2>
            {notes.map((note) => {
              const title = noteTitle(note.text) || t("projectGraph.noteEmpty");
              return (
                <button
                  key={note.id}
                  type="button"
                  data-testid="project-graph-note"
                  aria-label={title}
                  onClick={() => onSelectNote?.(note.id)}
                  className="flex w-full items-center rounded px-2 py-1 text-left text-[11px] outline-none hover:bg-accent/10 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="min-w-0 flex-1 truncate">{title}</span>
                </button>
              );
            })}
          </section>
        )}
        <p id={hintId} className="border-t px-2 py-1 text-[10px] text-muted-foreground">
          {t("projectGraph.surface.a11y.hint")}
        </p>
      </div>
      {/* Outside the disclosure: a canvas click must be announced even while the rail is closed. */}
      <p role="status" aria-live="polite" className="sr-only">
        {selected === null
          ? ""
          : t("projectGraph.nodeList.selected", {
              label: selected.label,
              kind: t(KIND_LABEL_KEYS[selected.kind]),
            })}
      </p>
    </div>
  );
}
