// Route inspector: what the wrapper declares, the security flags that gate the handler, what
// the handler reaches in the database (and through audited elevations), and its source.

import { tableId } from "@facilis.dev/analyze";
import { t, type MessageKey } from "@/i18n";
import type { ProjectGraphNode } from "@/facilis/graph-model";
import type { RouteDetails } from "@/facilis/graph-details";
import {
  Chip,
  DetailsSection,
  EmptyNote,
  NodeSelectChip,
  SourceJump,
  type ChipTone,
} from "./ProjectGraphDetailsSection";
import { ProjectGraphSourcePreview } from "./ProjectGraphSourcePreview";

const INPUT_ORDER = ["body", "form", "query", "params"] as const;

const INPUT_LABELS = {
  body: "projectGraph.input.body",
  form: "projectGraph.input.form",
  query: "projectGraph.input.query",
  params: "projectGraph.input.params",
} as const;

/** The chips the Security section shows; an unreadable flag (null) is not a positive flag. */
function securityFlags(
  details: RouteDetails | null,
): readonly { key: string; label: string; tone: ChipTone }[] {
  if (details === null) return [];
  const flags: { key: string; label: string; tone: ChipTone }[] = [];
  if (details.crossSite === true)
    flags.push({ key: "crossSite", label: t("projectGraph.flag.crossSite"), tone: "warning" });
  if (details.rawSql === true)
    flags.push({ key: "rawSql", label: t("projectGraph.flag.rawSql"), tone: "warning" });
  if (details.handlerBodyRead)
    flags.push({ key: "body", label: t("projectGraph.flag.handlerBody"), tone: "muted" });
  if (details.handlerFormRead)
    flags.push({ key: "form", label: t("projectGraph.flag.handlerForm"), tone: "muted" });
  return flags;
}

export interface ProjectGraphRouteDetailsProps {
  node: ProjectGraphNode;
  details: RouteDetails | null;
  sources: ReadonlyMap<string, string>;
  nodeLabel: (id: string) => string | null;
  onOpenFileAt: (file: string, line: number) => void;
  onSelectNode: (id: string) => void;
}

export function ProjectGraphRouteDetails({
  node,
  details,
  sources,
  nodeLabel,
  onOpenFileAt,
  onSelectNode,
}: ProjectGraphRouteDetailsProps) {
  if (node.data.kind !== "route") return null;
  const route = node.data;
  const inputs = INPUT_ORDER.filter((key) => route.input[key]);
  const flags = securityFlags(details);
  const relations = details?.relations ?? { used: [], unresolved: 0, rawSql: 0, opaque: false };
  const hasRelations = relations.used.length > 0 || relations.unresolved > 0 || relations.opaque;
  const elevations = details?.elevations ?? [];
  const columns = details?.dbColumns ?? [];
  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        <Chip mono tone="brand">
          {route.method + " " + route.path}
        </Chip>
        <Chip>{t(("projectGraph.wrapper." + route.wrapper) as MessageKey)}</Chip>
        {route.unknown && <Chip tone="warning">{t("projectGraph.unknown")}</Chip>}
      </div>
      <p className="text-[10px] text-muted-foreground">
        {t("projectGraph.permission", {
          permission:
            route.permission.length === 0 ? t("projectGraph.public") : route.permission.join(", "),
        })}
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
      {flags.length > 0 && (
        <DetailsSection title={t("projectGraph.section.security")}>
          <div className="flex flex-wrap gap-1">
            {flags.map((flag) => (
              <Chip key={flag.key} tone={flag.tone}>
                {flag.label}
              </Chip>
            ))}
          </div>
        </DetailsSection>
      )}
      <DetailsSection title={t("projectGraph.section.touches")}>
        {route.dbTables.length === 0 && columns.length === 0 ? (
          <EmptyNote message={t("projectGraph.empty.tables")} />
        ) : (
          <div className="flex flex-wrap gap-1">
            {route.dbTables.map((name) => (
              <NodeSelectChip
                key={name}
                id={tableId(name)}
                text={name}
                nodeLabel={nodeLabel}
                onSelect={onSelectNode}
              />
            ))}
            {columns.map((name) => (
              <Chip key={name} mono>
                {name}
              </Chip>
            ))}
          </div>
        )}
      </DetailsSection>
      <DetailsSection title={t("projectGraph.section.elevations")}>
        {elevations.length === 0 ? (
          <EmptyNote message={t("projectGraph.empty.elevations")} />
        ) : (
          <ul className="space-y-1">
            {elevations.map((elevation) => (
              <li
                key={elevation.source.file + ":" + elevation.source.line}
                className="rounded border px-1.5 py-0.5"
              >
                <div className="flex items-center gap-1">
                  <Chip mono tone="warning">
                    {t(("projectGraph.elevation." + elevation.kind) as MessageKey)}
                  </Chip>
                  {elevation.operation !== null && (
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px]">
                      {elevation.operation}
                    </span>
                  )}
                </div>
                {elevation.tables.length > 0 && (
                  <p className="truncate font-mono text-[9px] text-muted-foreground">
                    {elevation.tables.join(", ")}
                  </p>
                )}
                <SourceJump source={elevation.source} onOpenFileAt={onOpenFileAt} />
              </li>
            ))}
          </ul>
        )}
      </DetailsSection>
      <DetailsSection title={t("projectGraph.section.relations")}>
        {hasRelations ? (
          <div className="space-y-1">
            <div className="flex flex-wrap gap-1">
              {relations.unresolved > 0 && (
                <Chip tone="warning">
                  {t("projectGraph.flag.unresolved", { count: relations.unresolved })}
                </Chip>
              )}
              {relations.opaque && <Chip tone="warning">{t("projectGraph.flag.opaque")}</Chip>}
              {relations.rawSql > 0 && <Chip mono>{t("projectGraph.flag.rawSql")}</Chip>}
            </div>
            {relations.used.length > 0 && (
              <ul className="space-y-0.5">
                {relations.used.map((use) => (
                  <li
                    key={use.name + use.source.file + ":" + use.source.line}
                    className="rounded border px-1.5 py-0.5"
                  >
                    <span className="block truncate font-mono text-[9px]">{use.name}</span>
                    <SourceJump source={use.source} onOpenFileAt={onOpenFileAt} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <EmptyNote message={t("projectGraph.empty.relations")} />
        )}
      </DetailsSection>
      <ProjectGraphSourcePreview
        file={details?.source?.file ?? node.sourceFile}
        line={details?.source?.line ?? null}
        sources={sources}
        onOpenFileAt={onOpenFileAt}
      />
    </>
  );
}
