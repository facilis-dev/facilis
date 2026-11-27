// The Search panel's result rows, split out of SearchPane.tsx (pinned by the file-length
// ratchet) so the reveal-on-focus pattern lives in one place and can be rendered statically
// in tests (issue #215). ide/ ships no jsdom, so the row markup is the observable surface.
import ChevronRight from "~icons/lucide/chevron-right";
import ChevronDown from "~icons/lucide/chevron-down";
import Replace from "~icons/lucide/replace";
import X from "~icons/lucide/x";
import { t } from "@/i18n";
import { FileIcon } from "./fileIcon";
import type { SearchFileResult } from "@/vv/controller";

type SearchMatch = SearchFileResult["matches"][number];

const baseName = (rel: string) => rel.split("/").pop() ?? rel;
const dirName = (rel: string) => {
  const i = rel.lastIndexOf("/");
  return i <= 0 ? "" : rel.slice(0, i);
};

// Render one result line: leading indentation trimmed, the match span highlighted.
function MatchLine({
  preview,
  column,
  length,
}: {
  preview: string;
  column: number;
  length: number;
}) {
  const leading = preview.length - preview.trimStart().length;
  const text = preview.trimStart();
  const col = column - 1 - leading; // 0-based within the trimmed text
  if (col < 0 || col + length > text.length || length === 0) {
    return <span className="truncate">{text.slice(0, 240)}</span>;
  }
  return (
    <span className="truncate">
      {text.slice(0, col)}
      <span className="rounded-[2px] bg-warning/30 text-foreground">
        {text.slice(col, col + length)}
      </span>
      {text.slice(col + length)}
    </span>
  );
}

/** One matching file: the toggle keeps its state in aria-expanded, the actions stay in
 *  the tab order and are revealed (not display:none) whenever the row has focus. */
function SearchFileRow({
  rel,
  count,
  collapsed,
  showReplace,
  onToggle,
  onReplaceFile,
  onDismiss,
}: {
  rel: string;
  count: number;
  collapsed: boolean;
  showReplace: boolean;
  onToggle: () => void;
  onReplaceFile: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="group flex items-center gap-1 pr-2 pl-1 hover:bg-accent/40">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex min-w-0 flex-1 items-center gap-1 py-0.5 text-left"
      >
        {collapsed ? (
          <ChevronRight className="size-3.5 shrink-0" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0" />
        )}
        <FileIcon name={baseName(rel)} className="size-3.5 shrink-0" />
        <span className="truncate text-xs text-foreground">{baseName(rel)}</span>
        <span className="truncate text-[10px] text-muted-foreground/70">{dirName(rel)}</span>
      </button>
      <div className="flex shrink-0 items-center gap-0.5">
        {showReplace && (
          <button
            type="button"
            title={t("search.replaceInFile")}
            aria-label={t("search.replaceInFile")}
            onClick={onReplaceFile}
            className="flex size-4 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-accent hover:text-foreground"
          >
            <Replace className="size-3" />
          </button>
        )}
        <button
          type="button"
          title={t("search.dismiss")}
          aria-label={t("search.dismiss")}
          onClick={onDismiss}
          className="flex size-4 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-accent hover:text-foreground"
        >
          <X className="size-3" />
        </button>
        <span className="ml-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-muted px-1 text-[10px] text-muted-foreground group-focus-within:hidden group-hover:hidden">
          {count}
        </span>
      </div>
    </div>
  );
}

/** One match line; the named group keeps the reveal scoped to this row. */
function SearchMatchRow({
  rel,
  match,
  showReplace,
  onOpen,
  onReplace,
}: {
  rel: string;
  match: SearchMatch;
  showReplace: boolean;
  onOpen: () => void;
  onReplace: () => void;
}) {
  return (
    <div className="group/m flex items-center gap-1 py-px pr-2 pl-6 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center text-left"
        title={`${rel}:${match.line}:${match.column}`}
      >
        <MatchLine preview={match.preview} column={match.column} length={match.length} />
      </button>
      {showReplace && (
        <button
          type="button"
          title={t("search.replace")}
          aria-label={t("search.replace")}
          onClick={onReplace}
          className="flex size-4 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-focus-within/m:opacity-100 group-hover/m:opacity-100 hover:bg-accent"
        >
          <Replace className="size-3" />
        </button>
      )}
    </div>
  );
}

export interface SearchResultsProps {
  results: SearchFileResult[];
  collapsed: ReadonlySet<string>;
  showReplace: boolean;
  onToggle: (file: string) => void;
  onOpenMatch: (file: string, match: SearchMatch) => void;
  onReplaceFile: (file: string) => void;
  onReplaceMatch: (file: string, match: SearchMatch) => void;
  onDismiss: (file: string) => void;
}

export function SearchResults({
  results,
  collapsed,
  showReplace,
  onToggle,
  onOpenMatch,
  onReplaceFile,
  onReplaceMatch,
  onDismiss,
}: SearchResultsProps) {
  return (
    <>
      {results.map((f) => {
        const isCollapsed = collapsed.has(f.file);
        const rel =
          f.root && f.file.startsWith(f.root + "/") ? f.file.slice(f.root.length + 1) : f.file;
        return (
          <div key={f.file}>
            <SearchFileRow
              rel={rel}
              count={f.matches.length}
              collapsed={isCollapsed}
              showReplace={showReplace}
              onToggle={() => onToggle(f.file)}
              onReplaceFile={() => onReplaceFile(f.file)}
              onDismiss={() => onDismiss(f.file)}
            />
            {!isCollapsed &&
              f.matches.map((m, i) => (
                <SearchMatchRow
                  key={`${m.line}:${m.column}:${i}`}
                  rel={rel}
                  match={m}
                  showReplace={showReplace}
                  onOpen={() => onOpenMatch(f.file, m)}
                  onReplace={() => onReplaceMatch(f.file, m)}
                />
              ))}
          </div>
        );
      })}
    </>
  );
}
