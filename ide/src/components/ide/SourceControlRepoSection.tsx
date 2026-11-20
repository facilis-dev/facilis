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
import type { CommitGenerator } from "@/ai/commit-generation";
import type { GitChange, RepoState, ScmSession } from "@/vv/scm-session";
import { IconBtn, Row, Section, relTime } from "./SourceControlParts";
import { SourceControlCommitBox } from "./SourceControlCommitBox";

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
  configured,
  generate,
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
  /** The chat's provider/model/key are present: the generate control can run. */
  configured: boolean;
  generate: CommitGenerator["generate"];
  onNewBranch: () => void;
  onDiscard: (ch: GitChange) => void;
  onDiscardAll: () => void;
}) {
  const changedCount = repo.staged.length + repo.changes.length;
  const showBody = !collapsible || !collapsed;

  return (
    <div className="border-b">
      {/* repo header: name + branch + refresh */}
      <div className="group flex h-8 items-center gap-1 px-2">
        {collapsible ? (
          <button
            className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-accent"
            onClick={onToggle}
            title={collapsed ? t("scm.expand") : t("scm.collapse")}
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
                <span className="truncate">{repo.currentBranch ?? t("scm.detached")}</span>
                <ChevronDown className="size-3 shrink-0 opacity-60" />
              </TooltipTrigger>
              <TooltipContent side="bottom">{t("scm.switchBranch")}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuGroup>
                <DropdownMenuLabel>{t("scm.branches")}</DropdownMenuLabel>
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
                <Plus className="size-4" /> {t("scm.createBranch")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {repo.isRepo && (
          <IconBtn label={t("commitGraph.open")} onClick={onOpenGraph}>
            <GitFork className="size-3.5" />
          </IconBtn>
        )}

        <IconBtn label={t("scm.refresh")} onClick={() => void scm.refresh()} disabled={repo.busy}>
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
            <div className="p-3 text-xs text-muted-foreground">{t("scm.checkingRepo")}</div>
          ) : !repo.isRepo ? (
            <div className="flex flex-col gap-3 p-3 text-xs leading-relaxed text-muted-foreground">
              <p>{t("scm.notRepo")}</p>
              <Button size="sm" disabled={repo.busy} onClick={() => void scm.init(repo.root)}>
                <GitBranch className="size-4" /> {t("scm.initRepo")}
              </Button>
            </div>
          ) : (
            <>
              {/* commit box: the one place a generated message lands, and it never commits */}
              <SourceControlCommitBox
                repo={repo}
                scm={scm}
                configured={configured}
                generate={generate}
                onCommit={onCommit}
              />

              {repo.error && (
                <div className="border-t bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                  {repo.error}
                </div>
              )}

              <Section
                title={t("scm.stagedChanges")}
                count={repo.staged.length}
                actions={
                  repo.staged.length > 0 && (
                    <IconBtn
                      label={t("scm.unstageAll")}
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
                      label={t("scm.unstage")}
                      onClick={() => void scm.unstage(repo.root, ch)}
                      disabled={repo.busy}
                    >
                      <Minus className="size-3.5" />
                    </IconBtn>
                  </Row>
                ))}
              </Section>

              <Section
                title={t("scm.changes")}
                count={repo.changes.length}
                actions={
                  repo.changes.length > 0 && (
                    <>
                      <IconBtn
                        label={t("scm.discardAll")}
                        onClick={onDiscardAll}
                        disabled={repo.busy}
                      >
                        <RotateCcw className="size-3.5" />
                      </IconBtn>
                      <IconBtn
                        label={t("scm.stageAll")}
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
                      label={t("scm.discardChanges")}
                      onClick={() => onDiscard(ch)}
                      disabled={repo.busy}
                    >
                      <RotateCcw className="size-3.5" />
                    </IconBtn>
                    <IconBtn
                      label={t("scm.stageChanges")}
                      onClick={() => void scm.stage(repo.root, ch)}
                      disabled={repo.busy}
                    >
                      <Plus className="size-3.5" />
                    </IconBtn>
                  </Row>
                ))}
              </Section>

              {repo.staged.length === 0 && repo.changes.length === 0 && (
                <div className="p-3 text-xs text-muted-foreground">{t("scm.noChanges")}</div>
              )}

              {repo.history.length > 0 && (
                <Section
                  title={t("scm.history")}
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
