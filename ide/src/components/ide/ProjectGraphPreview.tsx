// The page inspector's static structure tree: nested boxes for the components/sections the
// analyzer found, each one a jump to its source file. It is deliberately a structure view, not
// a rendering: dynamic branches are marked and the analyzer caps the node count.

import type { PagePreview, PagePreviewNode } from "@facilis/analyze";
import { t } from "@/i18n";

interface PreviewTree {
  readonly node: PagePreviewNode;
  readonly children: readonly PreviewTree[];
}

function treeOf(preview: PagePreview): PreviewTree[] {
  const byParent = new Map<string | null, PagePreviewNode[]>();
  for (const node of preview.nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }
  const build = (node: PagePreviewNode): PreviewTree => ({
    node,
    children: (byParent.get(node.id) ?? []).map(build),
  });
  return (byParent.get(null) ?? []).map(build);
}

function PreviewBranch({
  tree,
  onOpenFile,
}: {
  tree: PreviewTree;
  onOpenFile: (file: string) => void;
}) {
  const node = tree.node;
  const file = node.file;
  const body = (
    <>
      <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{node.name}</span>
      {node.dynamic && (
        <span className="shrink-0 rounded border border-warning/40 px-1 text-[8px] text-warning">
          {t("projectGraph.preview.dynamic")}
        </span>
      )}
      {node.kind === "slot" && (
        <span className="shrink-0 rounded border px-1 text-[8px] text-muted-foreground">
          {t("projectGraph.preview.slot")}
        </span>
      )}
    </>
  );
  return (
    <li className="min-w-0">
      {file === null ? (
        <div className="flex min-w-0 items-center gap-1 rounded border bg-card/50 px-1.5 py-1">
          {body}
        </div>
      ) : (
        <button
          type="button"
          title={t("projectGraph.preview.open", { file })}
          className="flex w-full min-w-0 items-center gap-1 rounded border bg-card/50 px-1.5 py-1 text-left hover:bg-accent"
          onClick={() => onOpenFile(file)}
        >
          {body}
        </button>
      )}
      {tree.children.length > 0 && (
        <ul className="ml-2 space-y-1 border-l border-border/70 pl-1.5">
          {tree.children.map((child) => (
            <PreviewBranch key={child.node.id} tree={child} onOpenFile={onOpenFile} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function ProjectGraphPreview({
  preview,
  onOpenFile,
}: {
  preview: PagePreview;
  onOpenFile: (file: string) => void;
}) {
  const trees = treeOf(preview);
  if (trees.length === 0) {
    return <p className="text-[10px] text-muted-foreground">{t("projectGraph.preview.empty")}</p>;
  }
  return (
    <div data-testid="project-graph-preview" className="space-y-1">
      <p className="text-[9px] text-muted-foreground">{t("projectGraph.preview.staticNote")}</p>
      <ul className="space-y-1">
        {trees.map((tree) => (
          <PreviewBranch key={tree.node.id} tree={tree} onOpenFile={onOpenFile} />
        ))}
      </ul>
      {preview.truncated && (
        <p className="rounded border border-warning/40 bg-warning/5 px-1.5 py-1 text-[9px] text-warning">
          {t("projectGraph.preview.truncated")}
        </p>
      )}
    </div>
  );
}
