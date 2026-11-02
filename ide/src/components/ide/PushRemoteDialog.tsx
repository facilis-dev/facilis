import { useEffect, useState, useSyncExternalStore } from "react";
import type { ChangeEvent } from "react";
import { toast } from "sonner";
import Loader from "~icons/lucide/loader-circle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIde } from "./useIde";
import { t, type MessageKey } from "@/i18n";
import { deployment, pushAllowed } from "@/deploy/current";
import { loadGitIdentity, saveGitIdentity } from "@/vv/git-config";
import { normalizeGitToken, providerForInput } from "@/vv/git-provider";
import { ProjectPublish, type PushPlan } from "@/vv/project-publish";
import { publishSession } from "@/vv/publish-session";
import { githubSessionToken } from "@/vv/github-oauth";
import { GitHubSignIn } from "./GitHubSignIn";
import { PushRemoteFields } from "./PushRemoteFields";
import { PushRemotePlan, PushRemoteProgress } from "./PushRemotePlan";

// Prescribed publish default: it becomes the commit message, so it is data, not chrome.
const DEFAULT_MESSAGE = "Update from facilis.dev";

const pad2 = (value: number) => String(value).padStart(2, "0");

/** facilis/<local date>: a new branch per day, so repeated publishes do not collide. */
function defaultBranchName(): string {
  const now = new Date();
  return (
    "facilis/" + now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate())
  );
}

/** The last segment of the active project's root, which is the folder name. */
function folderLabelOf(root: string): string {
  return root.replace(/\/+$/, "").split("/").at(-1) ?? root;
}

/** The transfer phases the publish layer emits, as catalogue keys. */
function phaseKey(phase: string): MessageKey {
  if (phase === "uploading") return "push.phaseUploading";
  if (phase === "committing") return "push.phaseCommitting";
  return "push.phaseListing";
}

/**
 * Publish the open project to a GitHub/GitLab/Gitea branch as one API commit (D-078).
 * The token is the only secret here: component state only, never stored or logged, and
 * dropped when the dialog closes.
 */
export function PushRemoteDialog() {
  const { c, snap } = useIde();
  const { open } = useSyncExternalStore(publishSession.subscribe, publishSession.getSnapshot);
  const [repository, setRepository] = useState("");
  const [token, setToken] = useState("");
  const [createBranch, setCreateBranch] = useState(true);
  const [branch, setBranch] = useState(defaultBranchName);
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [authorName, setAuthorName] = useState("");
  const [authorEmail, setAuthorEmail] = useState("");
  const [plan, setPlan] = useState<PushPlan | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"idle" | "planning" | "publishing">("idle");
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(
    null,
  );
  const busy = status !== "idle";

  useEffect(() => {
    // A close must never keep the token. A fresh open drops the previous plan and
    // starts a new branch name: the open project may have changed.
    if (!open) {
      setToken("");
      return;
    }
    setPlan(null);
    setError("");
    setProgress(null);
    setStatus("idle");
    setCreateBranch(true);
    setBranch(defaultBranchName());
    const saved = loadGitIdentity();
    if (saved !== null) {
      setAuthorName(saved.name);
      setAuthorEmail(saved.email);
    }
  }, [open]);

  const root = snap.workspaceFolders.find((f) => f.id === snap.activeFolderId)?.rootPath ?? null;
  const folderName = root === null ? null : folderLabelOf(root);
  // An empty field falls back to the tab's GitHub sign-in (D-082).
  const effectiveToken = token.trim() !== "" ? token.trim() : (githubSessionToken() ?? "");
  const blocked = !pushAllowed(deployment)
    ? t("push.disabled")
    : root === null
      ? t("push.openProjectFirst")
      : !snap.kernelReady
        ? t("push.kernelStarting")
        : null;
  const canPlan = repository.trim() !== "" && effectiveToken !== "" && !busy && snap.kernelReady;
  const changes = plan === null ? 0 : plan.adds.length + plan.updates.length + plan.deletes.length;
  const canPublish = plan !== null && changes > 0 && !busy;
  const tokenInvalid = effectiveToken !== "" && normalizeGitToken(effectiveToken) === null;
  const summary =
    plan === null || changes === 0
      ? ""
      : t("push.summary", {
          added: plan.adds.length,
          modified: plan.updates.length,
          deleted: plan.deletes.length,
        });
  const target =
    plan === null
      ? ""
      : plan.createBranch
        ? t("push.summaryTarget", { branch: plan.branch, base: plan.baseBranch })
        : plan.branch;
  const progressText =
    progress === null
      ? ""
      : t("push.progress", { phase: progress.label, done: progress.done, total: progress.total });
  const checkLabel = status === "planning" ? t("push.checking") : t("push.check");
  const publishLabel = status === "publishing" ? t("push.publishing") : t("push.publish");

  const requestClose = () => {
    if (!busy) publishSession.close();
  };
  // Editing any field invalidates the plan: a stale diff must never reach Publish.
  const clearPlan = () => {
    setPlan(null);
    setError("");
    setProgress(null);
  };
  const editText = (apply: (value: string) => void) => (event: ChangeEvent<HTMLInputElement>) => {
    apply(event.target.value);
    clearPlan();
  };
  // No host picker: the URL names the host, and a bare owner/repo is GitHub, so the
  // provider is derived where it is needed instead of being chosen up front (D-079).
  const chooseRepository = (event: ChangeEvent<HTMLInputElement>) => {
    setRepository(event.target.value);
    clearPlan();
  };
  const toggleCreateBranch = (next: boolean) => {
    setCreateBranch(next);
    // The field means the new branch in one mode and the target branch in the other; a
    // value carried across would point at a branch that does not exist.
    setBranch(next ? defaultBranchName() : "");
    clearPlan();
  };
  // Built per action so its callbacks always see the current kernel state.
  const publisher = () =>
    new ProjectPublish({
      kernelReady: () => snap.kernelReady,
      readTree: (folder) => c.projectExport.readProjectTree(folder),
    });

  const checkChanges = async () => {
    // The blocked note is the inline explanation for these three cases.
    if (blocked !== null || !canPlan || root === null) return;
    const typed = effectiveToken;
    if (normalizeGitToken(typed) === null) {
      setError(t("push.tokenInvalid"));
      return;
    }
    setStatus("planning");
    setError("");
    setProgress(null);
    try {
      setPlan(
        await publisher().plan(
          {
            provider: providerForInput(repository.trim()),
            repository: repository.trim(),
            token: typed,
            branch: branch.trim(),
            createBranch,
          },
          root,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStatus("idle");
    }
  };

  const publishNow = async () => {
    if (plan === null || !canPublish) return;
    setStatus("publishing");
    setError("");
    try {
      const result = await publisher().push(plan, {
        token: effectiveToken,
        message,
        identity: { name: authorName, email: authorEmail },
        onProgress: (phase, done, total) => setProgress({ label: t(phaseKey(phase)), done, total }),
      });
      if (authorName.trim() !== "" && authorEmail.trim() !== "") {
        saveGitIdentity({ name: authorName, email: authorEmail });
      }
      toast.success(t("push.success", { branch: result.branch }), {
        description: t("push.successDescription", {
          commits: result.commits,
          repository: repository.trim(),
        }),
      });
      publishSession.close();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStatus("idle");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => next || requestClose()}>
      {/* The close button goes away while a transfer runs: every control is disabled. */}
      <DialogContent showCloseButton={!busy} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("push.title")}</DialogTitle>
          <DialogDescription>{t("push.description")}</DialogDescription>
        </DialogHeader>

        {folderName !== null && (
          <div className="truncate text-xs text-muted-foreground">{folderName}</div>
        )}
        {blocked !== null && <div className="text-xs text-muted-foreground">{blocked}</div>}

        <PushRemoteFields
          signIn={
            <GitHubSignIn
              onToken={(value) => {
                setToken(value ?? "");
                clearPlan();
              }}
            />
          }
          repository={repository}
          token={token}
          tokenInvalid={tokenInvalid}
          createBranch={createBranch}
          branch={branch}
          message={message}
          authorName={authorName}
          authorEmail={authorEmail}
          busy={busy}
          onRepository={chooseRepository}
          onToken={editText(setToken)}
          onCreateBranch={toggleCreateBranch}
          onBranch={editText(setBranch)}
          onMessage={editText(setMessage)}
          onAuthorName={editText(setAuthorName)}
          onAuthorEmail={editText(setAuthorEmail)}
        />

        {error !== "" && <div className="text-xs text-destructive">{error}</div>}

        {plan !== null && <PushRemotePlan changes={changes} summary={summary} target={target} />}

        {progress !== null && <PushRemoteProgress text={progressText} busy={busy} />}

        <DialogFooter>
          <Button variant="outline" onClick={requestClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="outline" onClick={() => void checkChanges()} disabled={!canPlan}>
            {status === "planning" && <Loader className="size-4 animate-spin" />} {checkLabel}
          </Button>
          <Button onClick={() => void publishNow()} disabled={!canPublish}>
            {status === "publishing" && <Loader className="size-4 animate-spin" />} {publishLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
