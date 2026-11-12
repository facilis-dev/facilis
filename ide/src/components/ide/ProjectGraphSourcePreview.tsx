// The inspector's "Source" section: a few lines around the fact's SourceRef, the anchor line
// highlighted, and a jump into the editor. It reads the source map the panel already loaded for
// this analysis, so nothing here touches the VFS.

import { t } from "@/i18n";
import { snippetAround } from "@/facilis/graph-source-snippet";
import { EmptyNote, SECTION_TITLE } from "./ProjectGraphDetailsSection";

/** Lines shown on each side of the anchor: enough for context, small enough for the aside. */
const CONTEXT_LINES = 3;

export interface ProjectGraphSourcePreviewProps {
  file: string | null;
  line: number | null;
  sources: ReadonlyMap<string, string>;
  onOpenFileAt: (file: string, line: number) => void;
}

export function ProjectGraphSourcePreview({
  file,
  line,
  sources,
  onOpenFileAt,
}: ProjectGraphSourcePreviewProps) {
  const text = file === null ? null : (sources.get(file) ?? null);
  const snippet = text === null ? null : snippetAround(text, line ?? 1, CONTEXT_LINES);
  // A SourceRef can point past the file the VFS still has (an analysis from before an edit):
  // the clamped anchor is what exists, so both the highlight and the jump use it.
  const openLine = snippet?.anchor ?? line ?? 1;
  return (
    <section className="space-y-1">
      <div className="flex items-baseline justify-between gap-1">
        <h3 className={SECTION_TITLE}>{t("projectGraph.section.source")}</h3>
        {snippet !== null && (
          <span className="shrink-0 text-[9px] text-muted-foreground">
            {t("projectGraph.source.lines", { from: snippet.from, to: snippet.to })}
          </span>
        )}
      </div>
      {snippet === null || file === null ? (
        <EmptyNote message={t("projectGraph.empty.source")} />
      ) : (
        <>
          <div className="overflow-auto rounded border bg-card/50 py-0.5 font-mono text-[9px]">
            {snippet.lines.map((row, index) => {
              const number = snippet.from + index;
              return (
                <div
                  key={number}
                  className={
                    "flex whitespace-pre" +
                    (number === openLine ? " bg-accent text-accent-foreground" : "")
                  }
                >
                  <span className="w-7 shrink-0 select-none pr-1 text-right text-muted-foreground">
                    {number}
                  </span>
                  <span className="min-w-0 flex-1">{row}</span>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="w-full rounded border px-1.5 py-0.5 text-left text-[10px] hover:bg-accent"
            onClick={() => onOpenFileAt(file, openLine)}
          >
            {t("projectGraph.source.open")}
          </button>
        </>
      )}
    </section>
  );
}
