// The icon + title of one editor tab. Split from EditorGroup.tsx to stay under the
// file-length ratchet; synthetic tabs (diff, API Flow) have no basename to render.
import Workflow from "~icons/lucide/workflow";
import { t } from "@/i18n";
import { isApiFlowTabId } from "@/vv/synthetic-tabs";
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
  return (
    <>
      {kind === "directory" ? (
        <FolderIcon className="size-3.5 shrink-0" />
      ) : isApiFlow ? (
        <Workflow className="size-3.5 shrink-0" />
      ) : (
        <FileIcon name={baseName(rel)} className="size-3.5 shrink-0" />
      )}
      <span className={italic ? "italic" : undefined}>
        {isApiFlow ? t("apiFlow.tabTitle") : baseName(rel)}
        {isDiff && <span className="ml-1 opacity-60">(Working Tree)</span>}
      </span>
    </>
  );
}
