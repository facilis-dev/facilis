// The project-graph inspector: page structure preview plus the page's incident links; view
// details (access mode, permission, base tables, the routes that use it); route and table nodes
// get a compact source summary. The page preview is the part that makes the page cards more than
// a filename, and the view section is what makes "which route reads this view" answerable.

import X from "~icons/lucide/x";
import { Button } from "@/components/ui/button";
import { t, type MessageKey } from "@/i18n";
import type { ProjectGraphEdge, ProjectGraphNode } from "@/facilis/graph-model";
import { ProjectGraphPreview } from "./ProjectGraphPreview";

const SECTION_TITLE = "text-[10px] font-semibold tracking-wide text-muted-foreground uppercase";

function SourceButton({
  source,
  onOpenFile,
}: {
  source: string;
  onOpenFile: (file: string) => void;
}) {
  return (
    <button
      type="button"
      title={t("projectGraph.openSource", { source })}
      className="block w-full truncate text-left font-mono text-[10px] text-muted-foreground hover:text-foreground"
      onClick={() => onOpenFile(source)}
    >
      {source}
    </button>
  );
}

function PageDetails({
  node,
  edges,
  onOpenFile,
}: {
  node: ProjectGraphNode;
  edges: readonly ProjectGraphEdge[];
  onOpenFile: (file: string) => void;
}) {
  const page = node.data.kind === "page" ? node.data : null;
  if (page === null) return null;
  const links = edges.filter((edge) => edge.kind === "page-link");
  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        <span className="rounded border px-1 text-[9px] text-muted-foreground">
          {t(("projectGraph.pageKind." + page.pageKind) as MessageKey)}
        </span>
        {page.routePaths.length === 0 ? (
          <span className="rounded border border-warning/50 px-1 text-[9px] text-warning">
            {t("projectGraph.pageUnrouted")}
          </span>
        ) : (
          page.routePaths.map((path) => (
            <span
              key={path}
              className="rounded border border-brand/40 bg-brand/10 px-1 font-mono text-[9px] text-brand"
            >
              {path}
            </span>
          ))
        )}
      </div>
      <SourceButton source={page.pagePath} onOpenFile={onOpenFile} />
      <section className="space-y-1">
        <h3 className={SECTION_TITLE}>{t("projectGraph.preview.title")}</h3>
        {page.preview === null ? (
          <p className="text-[10px] text-muted-foreground">{t("projectGraph.preview.empty")}</p>
        ) : (
          <ProjectGraphPreview preview={page.preview} onOpenFile={onOpenFile} />
        )}
      </section>
      <section className="space-y-1">
        <h3 className={SECTION_TITLE}>{t("projectGraph.links")}</h3>
        {links.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">{t("projectGraph.noLinks")}</p>
        ) : (
          <ul className="space-y-0.5">
            {links.map((edge) => (
              <li
                key={edge.id}
                className="truncate rounded border px-1.5 py-0.5 font-mono text-[9px]"
              >
                {edge.label ?? edge.target}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function ViewDetails({
  node,
  onOpenFile,
}: {
  node: ProjectGraphNode;
  onOpenFile: (file: string) => void;
}) {
  const view = node.data.kind === "view" ? node.data : null;
  if (view === null) return null;
  const source = node.sourceFile;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        <span className="rounded border px-1 text-[9px] text-muted-foreground">
          {t("projectGraph.node.view")}
        </span>
        {view.access !== null && (
          <span
            className={
              "rounded border px-1 text-[9px] " +
              (view.access === "definer"
                ? "border-warning/50 bg-warning/10 text-warning"
                : "border-border text-muted-foreground")
            }
          >
            {t(("projectGraph.access." + view.access) as MessageKey)}
          </span>
        )}
        <span className="rounded border px-1 font-mono text-[9px] text-info">
          {view.permission ?? t("projectGraph.public")}
        </span>
        {view.unknown && (
          <span className="rounded border border-warning/50 px-1 text-[9px] text-warning">
            {t("projectGraph.unknown")}
          </span>
        )}
      </div>
      {source !== null && <SourceButton source={source} onOpenFile={onOpenFile} />}
      <section className="space-y-1">
        <h3 className={SECTION_TITLE}>{t("projectGraph.baseTables")}</h3>
        {view.tables.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">{t("projectGraph.noBaseTables")}</p>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {view.tables.map((table) => (
              <li key={table} className="rounded border px-1 font-mono text-[9px]">
                {table}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-1">
        <h3 className={SECTION_TITLE}>{t("projectGraph.usedByRoutes")}</h3>
        {view.usedByRoutes.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">{t("projectGraph.noUsedByRoutes")}</p>
        ) : (
          // The route's source file is not part of the view's incident data, so the label is
          // what identifies the route here; double-clicking its card on the canvas opens it.
          <ul className="space-y-0.5">
            {view.usedByRoutes.map((route) => (
              <li
                key={route.id}
                className="truncate rounded border px-1.5 py-0.5 font-mono text-[9px]"
              >
                {route.label}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function OtherDetails({
  node,
  onOpenFile,
}: {
  node: ProjectGraphNode;
  onOpenFile: (file: string) => void;
}) {
  const source = node.sourceFile;
  return (
    <>
      <p className="truncate font-mono text-[11px]">{node.label}</p>
      {source !== null && <SourceButton source={source} onOpenFile={onOpenFile} />}
    </>
  );
}

export function ProjectGraphInspector({
  node,
  edges,
  onClose,
  onOpenFile,
}: {
  node: ProjectGraphNode;
  edges: readonly ProjectGraphEdge[];
  onClose: () => void;
  onOpenFile: (file: string) => void;
}) {
  return (
    <aside
      data-testid="project-graph-inspector"
      className="flex w-72 shrink-0 flex-col border-l bg-sidebar text-xs"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-2">
        <span className="flex-1 truncate text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          {t("projectGraph.details")}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("projectGraph.closeDetails")}
          title={t("projectGraph.closeDetails")}
          onClick={onClose}
        >
          <X />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-2">
        {node.data.kind === "page" ? (
          <PageDetails node={node} edges={edges} onOpenFile={onOpenFile} />
        ) : node.data.kind === "view" ? (
          <ViewDetails node={node} onOpenFile={onOpenFile} />
        ) : (
          <OtherDetails node={node} onOpenFile={onOpenFile} />
        )}
      </div>
    </aside>
  );
}
