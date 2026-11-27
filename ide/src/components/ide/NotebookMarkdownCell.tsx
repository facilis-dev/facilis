// The rendered form of a markdown cell, and the control that gets back into it (issue #221).
//
// The cell must stay a control while it is rendered, but it also holds arbitrary
// markdown and therefore links: role="button" would make every descendant
// presentational and take those links away from a screen reader. So the body is a
// labelled group that is itself focusable (Enter/F2 edit) and carries an explicit edit
// button; the links stay links. The group registers with the notebook's focus registry
// so Escape from the editor can come back here.
import { useEffect, useMemo, useRef } from "react";
import Pencil from "~icons/lucide/pencil";
import { t } from "@/i18n";
import type { Cell } from "@/vv/notebook/ipynb.js";
import { renderMarkdown } from "@/vv/notebook/render.js";
import type { NotebookFocus } from "./notebook-focus";

export function MarkdownCell({
  cell,
  index,
  total,
  focus,
  onEdit,
}: {
  cell: Cell;
  index: number;
  total: number;
  focus: NotebookFocus;
  onEdit: () => void;
}) {
  const html = useMemo(() => renderMarkdown(cell.source), [cell.source]);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    focus.register(cell.id, el);
    return () => focus.unregister(cell.id, el);
  }, [cell.id, focus]);

  const position = { index: index + 1, total };
  return (
    <div
      ref={ref}
      role="group"
      tabIndex={0}
      aria-label={t("notebook.markdownCellControl", position)}
      title={t("notebook.markdownEditHint")}
      onDoubleClick={onEdit}
      onKeyDown={(e) => {
        // A link inside the cell owns Enter; only the cell itself starts editing.
        if (e.target !== e.currentTarget || e.defaultPrevented) return;
        if (e.key !== "Enter" && e.key !== "F2") return;
        e.preventDefault();
        onEdit();
      }}
      className="relative rounded outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <button
        type="button"
        onClick={onEdit}
        title={t("notebook.markdownEditHint")}
        aria-label={t("notebook.markdownEdit", position)}
        className="absolute right-1 top-1 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-focus-within:opacity-100 group-hover:opacity-100"
      >
        <Pencil className="size-3" />
      </button>
      <div
        className="vv-md prose-sm max-w-none cursor-text overflow-x-auto rounded px-1 py-0.5 text-sm hover:bg-muted/30"
        // Contained on the same terms as an output, and for the same reason: a
        // markdown CELL is a stranger's document rendered when the file is opened,
        // which is the earlier half of the same threat. Nothing it can carry needs
        // this today — renderMarkdown escapes its input before any rule runs, so this
        // string contains only markup this studio generated (render.js) — and the
        // containment is here so that stops being the load-bearing fact.
        style={{ contain: "layout paint" }}
        dangerouslySetInnerHTML={{
          __html:
            html || `<span class="text-muted-foreground">${t("notebook.emptyMarkdown")}</span>`,
        }}
      />
    </div>
  );
}
