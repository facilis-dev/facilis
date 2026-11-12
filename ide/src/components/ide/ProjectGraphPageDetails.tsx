// Page inspector: the route table entry (or the fact that it has none), the schematic mini-page,
// the API calls the page makes and its explicit links. The labelled component tree that used to
// sit here is gone on owner request (D-176): at inspector width it read as the very structure the
// miniature exists to replace.

import { t, type MessageKey } from "@/i18n";
import type { ProjectGraphEdge, ProjectGraphNode } from "@/facilis/graph-model";
import type { PageDetails } from "@/facilis/graph-details";
import { Chip, DetailsSection, EmptyNote, NodeSelectChip } from "./ProjectGraphDetailsSection";
import { ProjectGraphPageSketch } from "./ProjectGraphPageSketch";
import { ProjectGraphSourcePreview } from "./ProjectGraphSourcePreview";

export interface ProjectGraphPageDetailsProps {
  node: ProjectGraphNode;
  edges: readonly ProjectGraphEdge[];
  details: PageDetails | null;
  sources: ReadonlyMap<string, string>;
  nodeLabel: (id: string) => string | null;
  onOpenFileAt: (file: string, line: number) => void;
  onOpenPreview: (path: string) => void;
  onSelectNode: (id: string) => void;
}

export function ProjectGraphPageDetails({
  node,
  edges,
  details,
  sources,
  nodeLabel,
  onOpenFileAt,
  onOpenPreview,
  onSelectNode,
}: ProjectGraphPageDetailsProps) {
  if (node.data.kind !== "page") return null;
  const page = node.data;
  const firstPath = page.routePaths[0];
  const calls = details?.calls ?? [];
  // Links are interesting in both directions: a page that is only linked-to should not read as
  // "no explicit page links". The chip names the far endpoint.
  const links = edges.filter(
    (edge) => edge.kind === "page-link" && (edge.source === node.id || edge.target === node.id),
  );
  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        <Chip>{t(("projectGraph.pageKind." + page.pageKind) as MessageKey)}</Chip>
        {page.routePaths.length === 0 ? (
          <Chip tone="warning">{t("projectGraph.pageUnrouted")}</Chip>
        ) : (
          page.routePaths.map((path) => (
            <Chip key={path} mono tone="brand">
              {path}
            </Chip>
          ))
        )}
      </div>
      <p className="truncate font-mono text-[10px] text-muted-foreground">{page.pagePath}</p>
      {firstPath !== undefined && (
        <button
          type="button"
          className="w-full rounded border px-1.5 py-0.5 text-left text-[10px] hover:bg-accent"
          onClick={() => onOpenPreview(firstPath)}
        >
          {t("projectGraph.preview.openInPreview")}
        </button>
      )}
      <DetailsSection title={t("projectGraph.preview.title")}>
        {page.preview === null || page.preview.nodes.length === 0 ? (
          <EmptyNote message={t("projectGraph.preview.empty")} />
        ) : (
          <>
            <ProjectGraphPageSketch preview={page.preview} />
            <p className="text-[9px] text-muted-foreground">
              {t("projectGraph.preview.staticNote")}
            </p>
            {page.preview.truncated && (
              <p className="text-[9px] text-warning">{t("projectGraph.preview.truncated")}</p>
            )}
          </>
        )}
      </DetailsSection>
      <DetailsSection title={t("projectGraph.section.calls")}>
        {calls.length === 0 ? (
          <EmptyNote message={t("projectGraph.empty.calls")} />
        ) : (
          <ul className="space-y-1">
            {calls.map((call) => (
              <li
                key={call.expression + call.source.file + ":" + call.source.line}
                className="rounded border px-1.5 py-0.5"
              >
                <p className="truncate font-mono text-[10px]">{call.expression}</p>
                <div className="flex flex-wrap gap-1">
                  {call.matchedRouteIds.map((id) => {
                    const label = nodeLabel(id);
                    if (label === null) return null;
                    return (
                      <Chip key={id} onClick={() => onSelectNode(id)}>
                        {t("projectGraph.call.route", { route: label })}
                      </Chip>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="block w-full truncate text-left font-mono text-[9px] text-muted-foreground hover:text-foreground"
                  onClick={() => onOpenFileAt(call.source.file, call.source.line)}
                >
                  {t("projectGraph.diagnosticSource", {
                    file: call.source.file,
                    line: call.source.line,
                  })}
                </button>
              </li>
            ))}
          </ul>
        )}
      </DetailsSection>
      <DetailsSection title={t("projectGraph.links")}>
        {links.length === 0 ? (
          <EmptyNote message={t("projectGraph.noLinks")} />
        ) : (
          <ul className="flex flex-wrap gap-1">
            {links.map((edge) => {
              const other = edge.source === node.id ? edge.target : edge.source;
              return (
                <li key={edge.id}>
                  <NodeSelectChip
                    id={other}
                    nodeLabel={nodeLabel}
                    onSelect={onSelectNode}
                    text={nodeLabel(other) ?? other}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </DetailsSection>
      <ProjectGraphSourcePreview
        file={details?.source?.file ?? page.pagePath}
        line={details?.source?.line ?? null}
        sources={sources}
        onOpenFileAt={onOpenFileAt}
      />
    </>
  );
}
