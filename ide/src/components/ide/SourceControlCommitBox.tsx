import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Sparkles from "~icons/lucide/sparkles";
import LoaderCircle from "~icons/lucide/loader-circle";
import Check from "~icons/lucide/check";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { t } from "@/i18n";
import type {
  CommitGenerationFailure,
  CommitGenerationResult,
  CommitGenerator,
} from "@/ai/commit-generation";
import type { RepoState, ScmSession } from "@/vv/scm-session";
import { createCommitBox, type CommitBoxSnapshot } from "./commit-box-state";

function failureText(failure: CommitGenerationFailure): string {
  if (failure.reason === "unconfigured") return t("scm.generate.noModel");
  if (failure.reason === "empty") return t("scm.generate.empty");
  return t("scm.generate.failed");
}

/** The presentational box: localised labels, the generate control and the inline states. */
export function CommitBoxView({
  repo,
  configured,
  box,
  onChange,
  onCommit,
  onGenerate,
  onConfirm,
  onDismiss,
}: {
  repo: RepoState;
  configured: boolean;
  box: CommitBoxSnapshot;
  onChange: (message: string) => void;
  onCommit: () => void;
  onGenerate: () => void;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const changed = repo.staged.length + repo.changes.length;
  const canCommit = repo.commitMessage.trim().length > 0 && !repo.busy && changed > 0;
  const canGenerate = configured && !repo.busy && changed > 0 && !box.running;

  return (
    <div className="flex flex-col gap-1.5 p-2">
      <Textarea
        value={repo.commitMessage}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canCommit) onCommit();
        }}
        placeholder={t("scm.messagePlaceholder", { branch: repo.currentBranch ?? "HEAD" })}
        className="min-h-16 resize-none text-xs"
      />
      <div className="flex gap-1.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="sm"
                variant="secondary"
                disabled={!canGenerate}
                aria-label={t("scm.generate")}
              />
            }
            onClick={onGenerate}
          >
            {box.running ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            <span>{box.running ? t("scm.generating") : t("scm.generate")}</span>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t("scm.generateHint")}</TooltipContent>
        </Tooltip>
        <Button size="sm" className="flex-1" disabled={!canCommit} onClick={onCommit}>
          <Check className="size-4" />
          {t("scm.commit")}
        </Button>
      </div>

      {box.error !== null && (
        <div className="text-xs text-destructive" role="status">
          {failureText(box.error)}
        </div>
      )}

      {box.pending !== null && (
        <div className="flex flex-col gap-1 rounded border bg-muted/40 p-2">
          <div className="text-xs text-muted-foreground">{t("scm.generate.confirm")}</div>
          <div className="max-h-24 overflow-auto whitespace-pre-wrap text-xs text-foreground">
            {box.pending}
          </div>
          <div className="flex gap-1.5">
            <Button size="sm" onClick={onConfirm}>
              {t("scm.generate.replace")}
            </Button>
            <Button size="sm" variant="secondary" onClick={onDismiss}>
              {t("scm.generate.keep")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One repository's commit box. Generation fills the textarea and never commits; the state
 * machine is commit-box-state.ts so the only-latest and confirmation rules stay testable.
 */
export function SourceControlCommitBox({
  repo,
  scm,
  configured,
  generate,
  onCommit,
}: {
  repo: RepoState;
  scm: ScmSession;
  configured: boolean;
  generate: CommitGenerator["generate"];
  onCommit: () => void;
}) {
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const generateRef = useRef(generate);
  generateRef.current = generate;

  const [box] = useState(() =>
    createCommitBox({
      root: repo.root,
      generate: (input): Promise<CommitGenerationResult> => {
        // Read the live scope at generation time: the snapshot may have moved since render.
        const current = scm.getSnapshot().repos.find((entry) => entry.root === repo.root);
        if (current === undefined) {
          return Promise.resolve({ ok: false, failure: { reason: "empty" } });
        }
        return generateRef.current({
          scope: { root: repo.root, staged: current.staged, changes: current.changes },
          signal: input.signal,
        });
      },
      readMessage: () =>
        scm.getSnapshot().repos.find((entry) => entry.root === repo.root)?.commitMessage ?? "",
      writeMessage: (message) => scm.setCommitMessage(repo.root, message),
      commit: () => commitRef.current(),
    }),
  );
  useEffect(() => () => box.dispose(), [box]);
  const snap = useSyncExternalStore(box.subscribe, box.getSnapshot);

  return (
    <CommitBoxView
      repo={repo}
      configured={configured}
      box={snap}
      onChange={(message) => scm.setCommitMessage(repo.root, message)}
      onCommit={box.commit}
      onGenerate={() => void box.start()}
      onConfirm={box.confirm}
      onDismiss={box.dismiss}
    />
  );
}
