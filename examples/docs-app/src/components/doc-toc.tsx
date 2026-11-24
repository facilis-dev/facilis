import type { TocEntry } from "../lib/markdown.ts";
import { t } from "../lib/i18n.tsx";
import { cn } from "../lib/utils.ts";

/** The per-page table of contents: depth-2/3 headings, anchored to the rendered ids. */
export function DocToc({ entries }: { entries: TocEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <nav aria-label={t("toc.label")} className="flex flex-col gap-2">
      <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
        {t("toc.title")}
      </p>
      <ul className="flex flex-col gap-1 border-l border-border">
        {entries.map((entry) => (
          <li key={entry.id}>
            <a
              href={"#" + entry.id}
              className={cn(
                "block border-l-2 border-transparent py-0.5 pl-3 text-sm text-muted-foreground transition-colors hover:border-accent hover:text-foreground",
                entry.depth === 3 && "pl-6",
              )}
            >
              {entry.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
