// One answer row in the project-graph inspector (issue #190): label, kind badge, domain and
// read/write tag, plus a click that follows the #187 jump path (nodeId) or opens the source.
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { Chip } from "./ProjectGraphDetailsSection";
import {
  ACCESS_MESSAGE_KEYS,
  KIND_MESSAGE_KEYS,
  type GraphAnswerRow,
} from "@/facilis/graph-surface/answers-types";

export interface ProjectGraphAnswerRowProps {
  row: GraphAnswerRow;
  onNavigateNode: (nodeId: string) => void;
  onOpenFileAt: (file: string, line: number) => void;
}

export function ProjectGraphAnswerRow({
  row,
  onNavigateNode,
  onOpenFileAt,
}: ProjectGraphAnswerRowProps) {
  const label = row.labelKey === null ? row.label : t(row.labelKey, row.labelParams ?? undefined);
  const detail =
    row.detailKey === null ? row.detail : t(row.detailKey, row.detailParams ?? undefined);
  const interactive = row.nodeId !== null || row.source !== null;
  const className = cn(
    "flex w-full min-w-0 items-center gap-1 rounded border px-1.5 py-0.5 text-left",
    interactive && "hover:border-ring",
  );
  const content = (
    <>
      <span className="min-w-0 flex-1 truncate font-mono text-[10px]" title={label}>
        {label}
      </span>
      <Chip>{t(KIND_MESSAGE_KEYS[row.kind])}</Chip>
      {row.domain !== null && (
        <span className="max-w-24 shrink-0 truncate text-[9px] text-muted-foreground">
          {row.domain}
        </span>
      )}
      {row.access !== null && (
        <Chip tone={row.access === "write" ? "warning" : "muted"}>
          {t(ACCESS_MESSAGE_KEYS[row.access])}
        </Chip>
      )}
      {detail !== null && detail.length > 0 && (
        <span
          className="max-w-28 shrink-0 truncate text-[9px] text-muted-foreground"
          title={detail}
        >
          {detail}
        </span>
      )}
    </>
  );
  const source = row.source;
  if (source !== null) {
    return (
      <button
        type="button"
        className={className}
        title={t("projectGraph.openSource", { source: source.file })}
        onClick={() => onOpenFileAt(source.file, source.line ?? 1)}
      >
        {content}
      </button>
    );
  }
  const nodeId = row.nodeId;
  if (nodeId !== null) {
    return (
      <button
        type="button"
        className={className}
        title={label}
        onClick={() => onNavigateNode(nodeId)}
      >
        {content}
      </button>
    );
  }
  return <div className={className}>{content}</div>;
}
