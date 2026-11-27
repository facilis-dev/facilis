import CaseSensitive from "~icons/lucide/case-sensitive";
import CaseUpper from "~icons/lucide/case-upper";
import ChevronDown from "~icons/lucide/chevron-down";
import ChevronRight from "~icons/lucide/chevron-right";
import Ellipsis from "~icons/lucide/ellipsis";
import Regex from "~icons/lucide/regex";
import ReplaceAll from "~icons/lucide/replace-all";
import WholeWord from "~icons/lucide/whole-word";
import { cn } from "@/lib/utils";

// A small VS Code-style toggle (Aa / whole-word / .* / preserve-case).
function Toggle({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground",
        active && "bg-primary/25 text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export interface SearchFormProps {
  readonly query: string;
  readonly onQueryChange: (value: string) => void;
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
  readonly regex: boolean;
  readonly regexError: string | null;
  readonly onToggleMatchCase: () => void;
  readonly onToggleWholeWord: () => void;
  readonly onToggleRegex: () => void;
  readonly showReplace: boolean;
  readonly onToggleReplace: () => void;
  readonly replaceText: string;
  readonly onReplaceTextChange: (value: string) => void;
  readonly preserveCase: boolean;
  readonly onTogglePreserveCase: () => void;
  readonly onReplaceAll: () => void;
  readonly canReplaceAll: boolean;
  readonly showDetails: boolean;
  readonly onToggleDetails: () => void;
  readonly includeGlob: string;
  readonly onIncludeGlobChange: (value: string) => void;
  readonly excludeGlob: string;
  readonly onExcludeGlobChange: (value: string) => void;
}

// The search form (issue #224). The bordered rows carry the focus ring on the shell,
// because the inner inputs suppress the native outline; the standalone glob inputs ring
// themselves, so every field shows where focus is without a one-off utility.
export function SearchForm({
  query,
  onQueryChange,
  matchCase,
  wholeWord,
  regex,
  regexError,
  onToggleMatchCase,
  onToggleWholeWord,
  onToggleRegex,
  showReplace,
  onToggleReplace,
  replaceText,
  onReplaceTextChange,
  preserveCase,
  onTogglePreserveCase,
  onReplaceAll,
  canReplaceAll,
  showDetails,
  onToggleDetails,
  includeGlob,
  onIncludeGlobChange,
  excludeGlob,
  onExcludeGlobChange,
}: SearchFormProps) {
  return (
    <>
      <div className="flex items-start gap-1 px-2 pb-2">
        <button
          type="button"
          title={showReplace ? "Hide Replace" : "Toggle Replace"}
          onClick={onToggleReplace}
          className="mt-1 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground"
        >
          {showReplace ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {/* search input row */}
          <div
            className={cn(
              "flex items-center gap-1 rounded border bg-background px-1.5 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
              regexError && "border-destructive",
            )}
          >
            <input
              autoFocus
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground ring-0"
            />
            <Toggle active={matchCase} onClick={onToggleMatchCase} title="Match Case">
              <CaseSensitive className="size-3.5" />
            </Toggle>
            <Toggle active={wholeWord} onClick={onToggleWholeWord} title="Match Whole Word">
              <WholeWord className="size-3.5" />
            </Toggle>
            <Toggle active={regex} onClick={onToggleRegex} title="Use Regular Expression">
              <Regex className="size-3.5" />
            </Toggle>
          </div>

          {regexError && <div className="px-0.5 text-[11px] text-destructive">{regexError}</div>}

          {/* replace input row */}
          {showReplace && (
            <div className="flex items-center gap-1">
              <div className="flex min-w-0 flex-1 items-center gap-1 rounded border bg-background px-1.5 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
                <input
                  value={replaceText}
                  onChange={(e) => onReplaceTextChange(e.target.value)}
                  placeholder="Replace"
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground ring-0"
                />
                <Toggle active={preserveCase} onClick={onTogglePreserveCase} title="Preserve Case">
                  <CaseUpper className="size-3.5" />
                </Toggle>
              </div>
              <button
                type="button"
                title="Replace All"
                disabled={!canReplaceAll}
                onClick={onReplaceAll}
                className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                <ReplaceAll className="size-4" />
              </button>
            </div>
          )}
        </div>

        <button
          type="button"
          title="Toggle Search Details"
          aria-pressed={showDetails}
          onClick={onToggleDetails}
          className={cn(
            "mt-1 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            showDetails && "bg-primary/25 text-foreground",
          )}
        >
          <Ellipsis className="size-4" />
        </button>
      </div>

      {showDetails && (
        <div className="flex flex-col gap-1 px-2 pb-2">
          <label className="px-0.5 text-[11px] text-muted-foreground">files to include</label>
          <input
            value={includeGlob}
            onChange={(e) => onIncludeGlobChange(e.target.value)}
            placeholder="e.g. src/**, *.ts"
            className="rounded border bg-background px-2 py-1 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <label className="px-0.5 text-[11px] text-muted-foreground">files to exclude</label>
          <input
            value={excludeGlob}
            onChange={(e) => onExcludeGlobChange(e.target.value)}
            placeholder="e.g. **/*.test.ts"
            className="rounded border bg-background px-2 py-1 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>
      )}
    </>
  );
}
