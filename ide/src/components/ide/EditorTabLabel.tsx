// The icon + title of one editor tab. Split from EditorGroup.tsx to stay under the
// file-length ratchet; synthetic tabs (diff, API Flow, commit graph) have no basename to
// render, so they carry their own label.
import Workflow from "~icons/lucide/workflow";
import GitFork from "~icons/lucide/git-fork";
import { t } from "@/i18n";
import { commitGraphRootOf, isApiFlowTabId, isCommitGraphTabId } from "@/vv/synthetic-tabs";
import type { TabKind } from "@/vv/controller";
import { FileIcon, FolderIcon } from "./fileIcon";

const baseName = (rel: string) => rel.split("/").pop() ?? rel;

export function EditorTabLabel({
  rel,
  kind,
  isDiff,
  italic,
}: {
  rel: string;
  kind: TabKind | undefined;
  isDiff: boolean;
  italic: boolean;
}) {
  const isApiFlow = isApiFlowTabId(rel);
  const isCommitGraph = isCommitGraphTabId(rel);
  const label = isApiFlow
    ? t("apiFlow.tabTitle")
    : isCommitGraph
      ? baseName(commitGraphRootOf(rel))
      : baseName(rel);
  return (
    <>
      {kind === "directory" ? (
        <FolderIcon className="size-3.5 shrink-0" />
      ) : isApiFlow ? (
        <Workflow className="size-3.5 shrink-0" />
      ) : isCommitGraph ? (
        <GitFork className="size-3.5 shrink-0" />
      ) : (
        <FileIcon name={baseName(rel)} className="size-3.5 shrink-0" />
      )}
      <span className={italic ? "italic" : undefined}>
        {label}
        {isDiff && <span className="ml-1 opacity-60">{t("diff.workingTree")}</span>}
      </span>
    </>
  );
}
