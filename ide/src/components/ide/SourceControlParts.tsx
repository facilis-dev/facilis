import type { ReactNode } from "react";
import GitBranch from "~icons/lucide/git-branch";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t, type MessageKey } from "@/i18n";
import { FileIcon } from "./fileIcon";
import type { ChangeLetter, GitChange } from "@/vv/scm-session";

/** Single-letter change badges: the word is the tooltip, the letter the compact mark. */
const LETTER_KEY: Record<ChangeLetter, MessageKey> = {
  A: "scm.letter.added",
  M: "scm.letter.modified",
  D: "scm.letter.deleted",
  U: "scm.letter.untracked",
};
const LETTER_CLASS: Record<ChangeLetter, string> = {
  A: "text-success",
  M: "text-warning",
  D: "text-destructive",
  U: "text-success",
};

export const baseName = (p: string) => p.split("/").pop() || p;

const dirName = (p: string) => {
  const i = p.lastIndexOf("/");
  return i > 0 ? p.slice(0, i) : "";
};

export function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-sidebar text-sm">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <GitBranch className="size-4" />
        <span className="flex-1">{t("scm.title")}</span>
      </div>
      {children}
    </div>
  );
}

export function Section({
  title,
  count,
  actions,
  icon,
  children,
}: {
  title: string;
  count: number;
  actions?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="border-t py-1">
      <div className="group flex h-6 items-center gap-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        <span className="flex-1">{title}</span>
        {/* Opacity, never hidden: a display:none child cannot take focus, so the
            focus-within reveal would never fire (issue #215). */}
        <span className="inline-flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          {actions}
        </span>
        {count > 0 && (
          <span className="ml-1 rounded-full bg-muted px-1.5 text-[10px] font-medium">{count}</span>
        )}
      </div>
      {children}
    </div>
  );
}

export function Row({
  ch,
  onOpen,
  children,
}: {
  ch: GitChange;
  onOpen: () => void;
  children?: ReactNode;
}) {
  const dir = dirName(ch.path);
  return (
    <div className="group flex h-6 cursor-pointer items-center gap-1.5 px-2 hover:bg-accent">
      <button
        type="button"
        onClick={onOpen}
        title={ch.path}
        // Stable hook for the browser gate: the row's classes are presentation, and the
        // a11y work moved the click target from the row to this button (issue #215).
        data-scm-change={ch.path}
        aria-label={`${t("scm.openDiff")}: ${ch.path}`}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <FileIcon name={baseName(ch.path)} className="size-3.5 shrink-0" />
        <span className="truncate text-xs text-foreground">{baseName(ch.path)}</span>
        {dir && <span className="truncate text-[11px] text-muted-foreground">{dir}</span>}
      </button>
      <span className="flex shrink-0 items-center gap-0.5">
        {/* Revealed whenever the row (button or one of these actions) has focus. */}
        <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          {children}
        </span>
        <span
          className={cn("w-3 text-center text-xs font-semibold", LETTER_CLASS[ch.letter])}
          title={t(LETTER_KEY[ch.letter])}
        >
          {ch.letter}
        </span>
      </span>
    </div>
  );
}

export function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        disabled={disabled}
        aria-label={label}
        className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function relTime(seconds: number): string {
  if (!seconds) return "";
  const diff = Date.now() / 1000 - seconds;
  if (diff < 60) return t("recent.justNow");
  if (diff < 3600) return t("recent.minutesAgo", { n: Math.floor(diff / 60) });
  if (diff < 86400) return t("recent.hoursAgo", { n: Math.floor(diff / 3600) });
  if (diff < 2592000) return t("recent.daysAgo", { n: Math.floor(diff / 86400) });
  return new Date(seconds * 1000).toLocaleDateString();
}
