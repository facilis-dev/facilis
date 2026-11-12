// Page inspector: the route table entry (or the fact that it has none), the analyzer's static
// structure, the API calls the page makes, the components it renders and its explicit links.

import { t, type MessageKey } from "@/i18n";
import type { ProjectGraphEdge, ProjectGraphNode } from "@/facilis/graph-model";
import type { PageDetails } from "@/facilis/graph-details";
import { declarationLineOf } from "@/facilis/graph-source-snippet";
import { Chip, DetailsSection, EmptyNote, NodeSelectChip } from "./ProjectGraphDetailsSection";
import { ProjectGraphPreview } from "./ProjectGraphPreview";
import { ProjectGraphSourcePreview } from "./ProjectGraphSourcePreview";

/** One file a page renders, deduplicated across the preview tree. */
interface PageComponent {
  readonly name: string;
  readonly file: string;
  readonly line: number;
}

function componentsOf(
  node: ProjectGraphNode,
  sources: ReadonlyMap<string, string>,
): readonly PageComponent[] {
  if (node.data.kind !== "page") return [];
  const seen = new Map<string, PageComponent>();
  for (const previewNode of node.data.preview?.nodes ?? []) {
    const file = previewNode.file;
    // The page's own root component is the page itself, not one of the pieces it renders.
    if (file === null || file === node.data.pagePath) continue;
    const key = file + "\u0000" + previewNode.name;
    if (seen.has(key)) continue;
    // The preview's own line is the JSX usage site; the list names the component, so it
    // opens its declaration in the defining file (line 1 when the shape is unknown).
    const line = declarationLineOf(sources.get(file), previewNode.name);
    seen.set(key, { name: previewNode.name, file, line });
  }
  return [...seen.values()];
}

export interface ProjectGraphPageDetailsProps {
  node: ProjectGraphNode;
  edges: readonly ProjectGraphEdge[];
  details: PageDetails | null;
  sources: ReadonlyMap<string, string>;
  locales: Readonly<Record<string, Readonly<Record<string, string>>>>;
  defaultLocale: string | null;
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
  locales,
  defaultLocale,
  nodeLabel,
  onOpenFileAt,
  onOpenPreview,
  onSelectNode,
}: ProjectGraphPageDetailsProps) {
  if (node.data.kind !== "page") return null;
  const page = node.data;
  const firstPath = page.routePaths[0];
  const calls = details?.calls ?? [];
  const components = componentsOf(node, sources);
  const links = edges.filter((edge) => edge.kind === "page-link" && edge.source === node.id);
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
        {page.preview === null ? (
          <EmptyNote message={t("projectGraph.preview.empty")} />
        ) : (
          <ProjectGraphPreview
            preview={page.preview}
            locales={locales}
            defaultLocale={defaultLocale}
            onOpenFileAt={onOpenFileAt}
          />
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
      {components.length > 0 && (
        <DetailsSection title={t("projectGraph.section.components")}>
          <ul className="flex flex-wrap gap-1">
            {components.map((component) => (
              <li key={component.file + "\u0000" + component.name}>
                <Chip
                  mono
                  title={t("projectGraph.openSource", { source: component.file })}
                  onClick={() => onOpenFileAt(component.file, component.line)}
                >
                  {component.name}
                </Chip>
              </li>
            ))}
          </ul>
        </DetailsSection>
      )}
      <DetailsSection title={t("projectGraph.links")}>
        {links.length === 0 ? (
          <EmptyNote message={t("projectGraph.noLinks")} />
        ) : (
          <ul className="flex flex-wrap gap-1">
            {links.map((edge) => (
              <li key={edge.id}>
                <NodeSelectChip
                  id={edge.target}
                  nodeLabel={nodeLabel}
                  onSelect={onSelectNode}
                  text={nodeLabel(edge.target) ?? edge.target}
                />
              </li>
            ))}
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
