import GitBranch from "~icons/lucide/git-branch";
import GitCommitHorizontal from "~icons/lucide/git-commit-horizontal";
import GitFork from "~icons/lucide/git-fork";
import FilePenLine from "~icons/lucide/file-pen-line";
import RefreshCw from "~icons/lucide/refresh-cw";
import Check from "~icons/lucide/check";
import Plus from "~icons/lucide/plus";
import Minus from "~icons/lucide/minus";
import RotateCcw from "~icons/lucide/rotate-ccw";
import ChevronDown from "~icons/lucide/chevron-down";
import History from "~icons/lucide/history";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import type { GitChange, RepoState, ScmSession } from "@/vv/scm-session";
import { IconBtn, Row, Section, relTime } from "./SourceControlParts";

/**
 * One repository's header, commit box, change sections and history. Pulled out of
 * SourceControlPanel so the panel stays under the file-length ratchet (D-019).
 */
export function RepoSection({
  repo,
  scm,
  collapsible,
  collapsed,
  onToggle,
  onOpenChange,
  onOpenFile,
  onOpenGraph,
  onCommit,
  onNewBranch,
  onDiscard,
  onDiscardAll,
}: {
  repo: RepoState;
  scm: ScmSession;
  collapsible: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onOpenChange: (ch: GitChange) => void;
  onOpenFile: (ch: GitChange) => void;
  onOpenGraph: () => void;
  onCommit: () => void;
  onNewBranch: () => void;
  onDiscard: (ch: GitChange) => void;
  onDiscardAll: () => void;
}) {
  const changedCount = repo.staged.length + repo.changes.length;
  const canCommit = !!repo.commitMessage.trim() && !repo.busy && changedCount > 0;
  const showBody = !collapsible || !collapsed;

  return (
    <div className="border-b">
      {/* repo header: name + branch + refresh */}
      <div className="group flex h-8 items-center gap-1 px-2">
        {collapsible ? (
          <button
            className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-accent"
            onClick={onToggle}
            title={collapsed ? "Expand" : "Collapse"}
          >
            <ChevronDown className={cn("size-4 transition-transform", collapsed && "-rotate-90")} />
          </button>
        ) : (
          <GitBranch className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold" title={repo.root}>
          {repo.name}
        </span>

        {repo.isRepo && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger
                render={
                  <DropdownMenuTrigger className="flex min-w-0 max-w-[45%] items-center gap-1 rounded px-1.5 py-0.5 text-[11px] hover:bg-accent" />
                }
              >
                <GitBranch className="size-3 shrink-0" />
                <span className="truncate">{repo.currentBranch ?? "(detached)"}</span>
                <ChevronDown className="size-3 shrink-0 opacity-60" />
              </TooltipTrigger>
              <TooltipContent side="bottom">Switch / create branch</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Branches</DropdownMenuLabel>
                {repo.branches.map((b) => (
                  <DropdownMenuItem
                    key={b}
                    onClick={() =>
                      b !== repo.currentBranch && void scm.checkoutBranch(repo.root, b)
                    }
                  >
                    <GitBranch className="size-4" />
                    <span className="flex-1 truncate">{b}</span>
                    {b === repo.currentBranch && <Check className="size-4" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onNewBranch}>
                <Plus className="size-4" /> Create new branch…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {repo.isRepo && (
          <IconBtn label={t("commitGraph.open")} onClick={onOpenGraph}>
            <GitFork className="size-3.5" />
          </IconBtn>
        )}

        <IconBtn label="Refresh" onClick={() => void scm.refresh()} disabled={repo.busy}>
          <RefreshCw className={cn("size-3.5", repo.busy && "animate-spin")} />
        </IconBtn>
        {changedCount > 0 && (
          <span className="ml-0.5 rounded-full bg-muted px-1.5 text-[10px] font-medium">
            {changedCount}
          </span>
        )}
      </div>

      {showBody && (
        <div className="border-t">
          {repo.checking && !repo.isRepo ? (
            <div className="p-3 text-xs text-muted-foreground">Checking for a repository…</div>
          ) : !repo.isRepo ? (
            <div className="flex flex-col gap-3 p-3 text-xs leading-relaxed text-muted-foreground">
              <p>
                This project is not a git repository. Initialize one to track changes, commit, and
                branch — all locally in your browser.
              </p>
              <Button size="sm" disabled={repo.busy} onClick={() => void scm.init(repo.root)}>
                <GitBranch className="size-4" /> Initialize Repository
              </Button>
            </div>
          ) : (
            <>
              {/* commit box */}
              <div className="flex flex-col gap-1.5 p-2">
                <Textarea
                  value={repo.commitMessage}
                  onChange={(e) => scm.setCommitMessage(repo.root, e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canCommit) onCommit();
                  }}
                  placeholder={`Message (⌘Enter to commit on "${repo.currentBranch ?? "HEAD"}")`}
                  className="min-h-16 resize-none text-xs"
                />
                <Button size="sm" disabled={!canCommit} onClick={onCommit}>
                  <Check className="size-4" /> Commit
                </Button>
              </div>

              {repo.error && (
                <div className="border-t bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                  {repo.error}
                </div>
              )}

              <Section
                title="Staged Changes"
                count={repo.staged.length}
                actions={
                  repo.staged.length > 0 && (
                    <IconBtn
                      label="Unstage all"
                      onClick={() => void scm.unstageAll(repo.root)}
                      disabled={repo.busy}
                    >
                      <Minus className="size-3.5" />
                    </IconBtn>
                  )
                }
              >
                {repo.staged.map((ch) => (
                  <Row key={"s:" + ch.path} ch={ch} onOpen={() => onOpenChange(ch)}>
                    <IconBtn label={t("scm.openFile")} onClick={() => onOpenFile(ch)}>
                      <FilePenLine className="size-3.5" />
                    </IconBtn>
                    <IconBtn
                      label="Unstage"
                      onClick={() => void scm.unstage(repo.root, ch)}
                      disabled={repo.busy}
                    >
                      <Minus className="size-3.5" />
                    </IconBtn>
                  </Row>
                ))}
              </Section>

              <Section
                title="Changes"
                count={repo.changes.length}
                actions={
                  repo.changes.length > 0 && (
                    <>
                      <IconBtn
                        label="Discard all changes"
                        onClick={onDiscardAll}
                        disabled={repo.busy}
                      >
                        <RotateCcw className="size-3.5" />
                      </IconBtn>
                      <IconBtn
                        label="Stage all changes"
                        onClick={() => void scm.stageAll(repo.root)}
                        disabled={repo.busy}
                      >
                        <Plus className="size-3.5" />
                      </IconBtn>
                    </>
                  )
                }
              >
                {repo.changes.map((ch) => (
                  <Row key={"c:" + ch.path} ch={ch} onOpen={() => onOpenChange(ch)}>
                    <IconBtn label={t("scm.openFile")} onClick={() => onOpenFile(ch)}>
                      <FilePenLine className="size-3.5" />
                    </IconBtn>
                    <IconBtn
                      label="Discard changes"
                      onClick={() => onDiscard(ch)}
                      disabled={repo.busy}
                    >
                      <RotateCcw className="size-3.5" />
                    </IconBtn>
                    <IconBtn
                      label="Stage changes"
                      onClick={() => void scm.stage(repo.root, ch)}
                      disabled={repo.busy}
                    >
                      <Plus className="size-3.5" />
                    </IconBtn>
                  </Row>
                ))}
              </Section>

              {repo.staged.length === 0 && repo.changes.length === 0 && (
                <div className="p-3 text-xs text-muted-foreground">No changes.</div>
              )}

              {repo.history.length > 0 && (
                <Section
                  title="History"
                  count={repo.history.length}
                  icon={<History className="size-3.5" />}
                >
                  {repo.history.map((cm) => (
                    <div key={cm.oid} className="flex items-start gap-2 px-3 py-1 text-xs">
                      <GitCommitHorizontal className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-foreground" title={cm.message}>
                          {cm.message}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {cm.oid.slice(0, 7)} · {cm.author} · {relTime(cm.timestamp)}
                        </div>
                      </div>
                    </div>
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
