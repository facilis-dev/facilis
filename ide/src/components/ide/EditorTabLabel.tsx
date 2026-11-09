// The icon + title of one editor tab. Split from EditorGroup.tsx to stay under the
// file-length ratchet; synthetic tabs (diff, commit graph, project graph, data query) have
// no basename to render, so they carry their own label.
import GitFork from "~icons/lucide/git-fork";
import Network from "~icons/lucide/network";
import SquareTerminal from "~icons/lucide/square-terminal";
import { t } from "@/i18n";
import {
  commitGraphRootOf,
  isCommitGraphTabId,
  isDataQueryTabId,
  isProjectGraphTabId,
} from "@/vv/synthetic-tabs";
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
  const isCommitGraph = isCommitGraphTabId(rel);
  const isProjectGraph = isProjectGraphTabId(rel);
  const isDataQuery = isDataQueryTabId(rel);
  const label = isProjectGraph
    ? t("projectGraph.tabTitle")
    : isDataQuery
      ? t("dataQuery.tabTitle")
      : isCommitGraph
        ? baseName(commitGraphRootOf(rel))
        : baseName(rel);
  return (
    <>
      {kind === "directory" ? (
        <FolderIcon name={label} className="size-3.5 shrink-0" />
      ) : isProjectGraph ? (
        <Network className="size-3.5 shrink-0" />
      ) : isDataQuery ? (
        <SquareTerminal className="size-3.5 shrink-0" />
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
