// The project-graph inspector: page structure preview plus the page's explicit navigation
// links. Route/table nodes get a compact source summary; the page preview is the part that
// makes the page cards more than a filename.

import X from "~icons/lucide/x";
import { Button } from "@/components/ui/button";
import { t, type MessageKey } from "@/i18n";
import type { ProjectGraphEdge, ProjectGraphNode } from "@/facilis/graph-model";
import { ProjectGraphPreview } from "./ProjectGraphPreview";

function PageDetails({
  node,
  links,
  onOpenFile,
}: {
  node: ProjectGraphNode;
  links: readonly ProjectGraphEdge[];
  onOpenFile: (file: string) => void;
}) {
  const page = node.data.kind === "page" ? node.data : null;
  if (page === null) return null;
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
      <button
        type="button"
        title={t("projectGraph.openSource", { source: page.pagePath })}
        className="block w-full truncate text-left font-mono text-[10px] text-muted-foreground hover:text-foreground"
        onClick={() => onOpenFile(page.pagePath)}
      >
        {page.pagePath}
      </button>
      <section className="space-y-1">
        <h3 className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          {t("projectGraph.preview.title")}
        </h3>
        {page.preview === null ? (
          <p className="text-[10px] text-muted-foreground">{t("projectGraph.preview.empty")}</p>
        ) : (
          <ProjectGraphPreview preview={page.preview} onOpenFile={onOpenFile} />
        )}
      </section>
      <section className="space-y-1">
        <h3 className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          {t("projectGraph.links")}
        </h3>
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

function WorkflowDetails({
  node,
  onOpenFile,
}: {
  node: ProjectGraphNode;
  onOpenFile: (file: string) => void;
}) {
  const workflow = node.data.kind === "workflow" ? node.data : null;
  if (workflow === null) return null;
  return (
    <>
      <p className="truncate font-mono text-[11px]">{workflow.name}</p>
      {node.sourceFile !== null && (
        <button
          type="button"
          title={t("projectGraph.openSource", { source: node.sourceFile })}
          className="block w-full truncate text-left font-mono text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => onOpenFile(node.sourceFile ?? "")}
        >
          {node.sourceFile}
        </button>
      )}
      <section className="space-y-1">
        <h3 className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          {t("projectGraph.workflow.title")}
        </h3>
        {workflow.steps.length === 0 ? (
          <p className="text-[10px] text-muted-foreground">{t("projectGraph.workflow.empty")}</p>
        ) : (
          <ol className="space-y-1">
            {workflow.steps.map((step) => (
              <li key={step.index} className="rounded border px-1.5 py-0.5">
                <div className="flex items-center gap-1">
                  <span className="shrink-0 text-[9px] text-muted-foreground">
                    {step.index + 1}.
                  </span>
                  <span className="shrink-0 rounded border px-1 text-[9px] text-muted-foreground">
                    {t(("projectGraph.workflow." + step.kind) as MessageKey)}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px]">
                    {step.name ?? "?"}
                  </span>
                </div>
                {(step.permission !== null || step.onRejectStep !== null) && (
                  <p className="mt-0.5 text-[9px] text-muted-foreground">
                    {step.permission !== null &&
                      t("projectGraph.workflow.permission", { permission: step.permission })}
                    {step.permission !== null && step.onRejectStep !== null ? " · " : ""}
                    {step.onRejectStep !== null &&
                      t("projectGraph.workflow.onReject", { step: step.onRejectStep + 1 })}
                  </p>
                )}
              </li>
            ))}
          </ol>
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
      {source !== null && (
        <button
          type="button"
          title={t("projectGraph.openSource", { source })}
          className="block w-full truncate text-left font-mono text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => onOpenFile(source)}
        >
          {source}
        </button>
      )}
    </>
  );
}

export function ProjectGraphInspector({
  node,
  links,
  onClose,
  onOpenFile,
}: {
  node: ProjectGraphNode;
  links: readonly ProjectGraphEdge[];
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
          <PageDetails node={node} links={links} onOpenFile={onOpenFile} />
        ) : node.data.kind === "workflow" ? (
          <WorkflowDetails node={node} onOpenFile={onOpenFile} />
        ) : (
          <OtherDetails node={node} onOpenFile={onOpenFile} />
        )}
      </div>
    </aside>
  );
}
