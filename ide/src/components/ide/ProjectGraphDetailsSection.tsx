// Shared chrome for the project-graph inspector's per-kind sections: the uppercase section
// heading, the small data chips (a button when they select a graph node) and the source-line
// jump. One module so the five kind components agree on the look without importing each other.

import type { ReactNode } from "react";
import type { SourceRef } from "@facilis.dev/analyze";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export const SECTION_TITLE =
  "text-[10px] font-semibold tracking-wide text-muted-foreground uppercase";

export function DetailsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className={SECTION_TITLE}>{title}</h3>
      {children}
    </section>
  );
}

export function EmptyNote({ message }: { message: string }) {
  return <p className="text-[10px] text-muted-foreground">{message}</p>;
}

export type ChipTone = "muted" | "warning" | "brand" | "info";

const CHIP_TONE: Record<ChipTone, string> = {
  muted: "border-border text-muted-foreground",
  warning: "border-warning/50 bg-warning/10 text-warning",
  brand: "border-brand/40 bg-brand/10 text-brand",
  info: "border-border text-info",
};

/** A small chip; a button when it selects a graph node, a span otherwise. */
export function Chip({
  children,
  tone = "muted",
  mono = false,
  title,
  onClick,
}: {
  children: ReactNode;
  tone?: ChipTone;
  mono?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  const className = cn(
    "max-w-full truncate rounded border px-1 text-[9px]",
    CHIP_TONE[tone],
    mono && "font-mono",
    onClick !== undefined && "hover:border-ring",
  );
  if (onClick === undefined)
    return (
      <span className={className} title={title}>
        {children}
      </span>
    );
  return (
    <button type="button" className={className} title={title} onClick={onClick}>
      {children}
    </button>
  );
}

/**
 * A route's `dbTables` names tables and views alike, but a detail list only knows the name, so
 * the table id spelling is retried as a view before calling the chip inert.
 */
function resolveNodeId(
  id: string,
  nodeLabel: (id: string) => string | null,
): { id: string; label: string } | null {
  const label = nodeLabel(id);
  if (label !== null) return { id, label };
  if (id.startsWith("table:")) {
    const view = "view:" + id.slice("table:".length);
    const viewLabel = nodeLabel(view);
    if (viewLabel !== null) return { id: view, label: viewLabel };
  }
  return null;
}

/**
 * A chip over a graph node id: selectable only when the drawn view still has a node for it, so
 * a detail list naming a filtered or unresolved id never hands the canvas a dead selection.
 */
export function NodeSelectChip({
  id,
  text,
  nodeLabel,
  onSelect,
}: {
  id: string;
  text?: string;
  nodeLabel: (id: string) => string | null;
  onSelect: (id: string) => void;
}) {
  const target = resolveNodeId(id, nodeLabel);
  return (
    <Chip
      mono
      onClick={target === null ? undefined : () => onSelect(target.id)}
      title={target?.label ?? undefined}
    >
      {text ?? target?.label ?? id}
    </Chip>
  );
}

/** A "file:line" jump: the inspector's facts always carry the line they were declared on. */
export function SourceJump({
  source,
  onOpenFileAt,
}: {
  source: SourceRef;
  onOpenFileAt: (file: string, line: number) => void;
}) {
  return (
    <button
      type="button"
      title={t("projectGraph.openAtLine", { line: source.line })}
      className="block w-full truncate text-left font-mono text-[9px] text-muted-foreground hover:text-foreground"
      onClick={() => onOpenFileAt(source.file, source.line)}
    >
      {t("projectGraph.diagnosticSource", { file: source.file, line: source.line })}
    </button>
  );
}
