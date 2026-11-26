// Route body of the rich card (issue #188): permission/access, wrapper, description, Zod-derived
// input chips, the declared dbTables and the audited elevations. Unknown or unreadable facts are
// shown as a warning chip rather than assumed away.

import { t, type MessageKey } from "@/i18n";
import type { RouteDetails } from "@/facilis/graph-details";
import type { RouteGraphData } from "@/facilis/graph-model";
import { capList, routeInputKeys, type RouteInputKey } from "@/facilis/graph-surface/card-facts";
import { Chip, DetailsSection, EmptyNote, NodeSelectChip } from "./ProjectGraphDetailsSection";

const INPUT_LABELS: Readonly<Record<RouteInputKey, MessageKey>> = {
  body: "projectGraph.input.body",
  form: "projectGraph.input.form",
  query: "projectGraph.input.query",
  params: "projectGraph.input.params",
};

export function ProjectGraphRichCardRoute({
  route,
  details,
  nodeLabel,
  onSelectNode,
}: {
  route: RouteGraphData;
  details: RouteDetails | null;
  nodeLabel: (id: string) => string | null;
  onSelectNode: (id: string) => void;
}) {
  const inputs = routeInputKeys(route.input);
  const tables = capList(route.dbTables);
  const elevations = details?.elevations ?? route.elevations;
  const relations = details?.relations ?? null;
  const permission =
    route.permission.length === 0 ? t("projectGraph.public") : route.permission.join(", ");
  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        <Chip mono tone="brand">
          {route.method + " " + route.path}
        </Chip>
        <Chip>{t(("projectGraph.wrapper." + route.wrapper) as MessageKey)}</Chip>
        {route.unknown && <Chip tone="warning">{t("projectGraph.unknown")}</Chip>}
        {details === null && <Chip tone="warning">{t("projectGraph.surface.card.noDetails")}</Chip>}
      </div>
      <p className="text-[10px] text-muted-foreground">
        {t("projectGraph.permission", { permission })}
      </p>
      {route.description !== null && <p className="text-[10px]">{route.description}</p>}
      {(inputs.length > 0 || route.pathParams.length > 0) && (
        <DetailsSection title={t("projectGraph.section.inputs")}>
          <div className="flex flex-wrap gap-1">
            {inputs.map((key) => (
              <Chip key={key}>{t(INPUT_LABELS[key])}</Chip>
            ))}
            {route.pathParams.map((name) => (
              <Chip key={name} mono>
                {t("projectGraph.pathParam", { name })}
              </Chip>
            ))}
          </div>
        </DetailsSection>
      )}
      <DetailsSection title={t("projectGraph.section.touches")}>
        {tables.visible.length === 0 ? (
          <EmptyNote message={t("projectGraph.empty.tables")} />
        ) : (
          <div className="flex flex-wrap gap-1">
            {tables.visible.map((name) => (
              <NodeSelectChip
                key={name}
                id={"table:" + name}
                text={name}
                nodeLabel={nodeLabel}
                onSelect={onSelectNode}
              />
            ))}
            {tables.hidden > 0 && (
              <Chip tone="muted">
                {t("projectGraph.surface.card.more", { count: tables.hidden })}
              </Chip>
            )}
          </div>
        )}
      </DetailsSection>
      <DetailsSection title={t("projectGraph.section.elevations")}>
        {elevations.length === 0 ? (
          <EmptyNote message={t("projectGraph.empty.elevations")} />
        ) : (
          <ul className="space-y-0.5">
            {elevations.map((elevation) => (
              <li
                key={elevation.kind + elevation.source.file + ":" + elevation.source.line}
                className="flex items-center gap-1 rounded border px-1.5 py-0.5"
              >
                <Chip mono tone="warning">
                  {t(("projectGraph.elevation." + elevation.kind) as MessageKey)}
                </Chip>
                {elevation.operation !== null && (
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px]">
                    {elevation.operation}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </DetailsSection>
      {relations !== null &&
        (relations.unresolved > 0 || relations.opaque || relations.rawSql > 0) && (
          <div className="flex flex-wrap gap-1">
            {relations.unresolved > 0 && (
              <Chip tone="warning">
                {t("projectGraph.flag.unresolved", { count: relations.unresolved })}
              </Chip>
            )}
            {relations.opaque && <Chip tone="warning">{t("projectGraph.flag.opaque")}</Chip>}
            {relations.rawSql > 0 && <Chip mono>{t("projectGraph.flag.rawSql")}</Chip>}
          </div>
        )}
    </>
  );
}
