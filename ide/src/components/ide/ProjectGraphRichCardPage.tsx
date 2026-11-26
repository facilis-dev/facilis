// Page body of the rich card (issue #188): the page path, its route paths, the bounded static
// wireframe built from the analyzer PagePreview, and the API routes it calls.

import { t } from "@/i18n";
import type { PageDetails } from "@/facilis/graph-details";
import type { PageGraphData } from "@/facilis/graph-model";
import { capList } from "@/facilis/graph-surface/card-facts";
import { Chip, DetailsSection, EmptyNote, NodeSelectChip } from "./ProjectGraphDetailsSection";
import { ProjectGraphPageSketch } from "./ProjectGraphPageSketch";

export function ProjectGraphRichCardPage({
  page,
  details,
  nodeLabel,
  onSelectNode,
}: {
  page: PageGraphData;
  details: PageDetails | null;
  nodeLabel: (id: string) => string | null;
  onSelectNode: (id: string) => void;
}) {
  const routes = capList(page.routePaths);
  const calls = capList(details?.calls ?? []);
  const preview = page.preview;
  return (
    <>
      <p className="truncate font-mono text-[10px] text-muted-foreground" title={page.pagePath}>
        {page.pagePath}
      </p>
      <DetailsSection title={t("projectGraph.surface.card.routes")}>
        {routes.visible.length === 0 ? (
          <EmptyNote message={t("projectGraph.pageUnrouted")} />
        ) : (
          <div className="flex flex-wrap gap-1">
            {routes.visible.map((path) => (
              <Chip key={path} mono tone="brand">
                {path}
              </Chip>
            ))}
            {routes.hidden > 0 && (
              <Chip tone="muted">
                {t("projectGraph.surface.card.more", { count: routes.hidden })}
              </Chip>
            )}
          </div>
        )}
      </DetailsSection>
      <DetailsSection title={t("projectGraph.preview.title")}>
        {preview === null || preview.nodes.length === 0 ? (
          <EmptyNote message={t("projectGraph.preview.empty")} />
        ) : (
          <>
            <ProjectGraphPageSketch preview={preview} />
            <p className="text-[9px] text-muted-foreground">
              {t("projectGraph.preview.staticNote")}
            </p>
            {preview.truncated && (
              <p className="text-[9px] text-warning">{t("projectGraph.preview.truncated")}</p>
            )}
          </>
        )}
      </DetailsSection>
      <DetailsSection title={t("projectGraph.section.calls")}>
        {details === null ? (
          <EmptyNote message={t("projectGraph.surface.card.noDetails")} />
        ) : calls.visible.length === 0 ? (
          <EmptyNote message={t("projectGraph.empty.calls")} />
        ) : (
          <ul className="space-y-1">
            {calls.visible.map((call) => (
              <li
                key={call.expression + call.source.file + ":" + call.source.line}
                className="rounded border px-1.5 py-0.5"
              >
                <p className="truncate font-mono text-[10px]" title={call.expression}>
                  {call.expression}
                </p>
                <div className="flex flex-wrap gap-1 pt-0.5">
                  {call.matchedRouteIds.map((id) => (
                    <NodeSelectChip
                      key={id}
                      id={id}
                      nodeLabel={nodeLabel}
                      onSelect={onSelectNode}
                    />
                  ))}
                </div>
              </li>
            ))}
            {calls.hidden > 0 && (
              <li>
                <Chip tone="muted">
                  {t("projectGraph.surface.card.more", { count: calls.hidden })}
                </Chip>
              </li>
            )}
          </ul>
        )}
      </DetailsSection>
    </>
  );
}
