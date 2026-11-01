import { useEffect, useState } from "react";
import Loader from "~icons/lucide/loader-circle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIde } from "./useIde";
import { t } from "@/i18n";
import {
  hostOfGitInput,
  normalizeGitToken,
  parseGitRepo,
  providerForInput,
  type GitProvider,
} from "@/vv/git-provider";
import { proxyBase } from "@/vv/git-remote";
import { gitAvailable } from "@/vv/project-clone";
import { TokenHelp } from "./TokenHelp";

/** The hosted service's host for a provider; a pasted URL overrides it. */
const PROVIDER_HOSTS: Record<GitProvider, string> = {
  github: "github.com",
  gitlab: "gitlab.com",
  gitea: "gitea.com",
};

/**
 * The clone URL for real git (D-079): a full URL is used as-is; an owner/repo shorthand
 * is expanded against the selected host. Null when the input is not a repository.
 */
function toCloneUrl(input: string, provider: GitProvider): string | null {
  if (input.includes("://")) return input;
  const ref = parseGitRepo(input, provider);
  if (ref === null) return null;
  const host = hostOfGitInput(input) ?? PROVIDER_HOSTS[provider];
  return "https://" + host + "/" + ref.owner + "/" + ref.repo + ".git";
}

// Import a project from a git host (GitHub, GitLab, Gitea/Forgejo).
// Snapshot-driven (c.openImportRemote / c.closeImportRemote) so it works from Home and the
// command palette alike. A private repository's token lives only in this component: it is
// handed to the importer and dropped when the dialog closes (D-073).
export function ImportRemoteDialog() {
  const { c, snap } = useIde();
  const open = snap.importRemoteOpen;
  const [repo, setRepo] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    if (open) {
      setBusy(false);
      setProgress("");
    } else {
      // Never keep a secret around after the dialog closed.
      setToken("");
    }
  }, [open]);

  // The copy must match the transport: with the proxy the download is a real git clone
  // through this installation (nothing stored, nothing logged), not the host's REST API,
  // so the CORS sentence is only true for the fallback (D-073/D-079).
  const realGit = proxyBase() !== null;
  const canSubmit = !!repo.trim() && !busy && snap.kernelReady;

  const onProgress = (done: number, total: number, phase: string) => {
    setProgress(total > 0 ? t("import.progress", { phase, done, total }) : phase);
  };
  // isomorphic-git reports (phase, loaded, total); the REST importer (done, total, phase).
  const onCloneProgress = (phase: string, loaded: number, total: number) => {
    setProgress(total > 0 ? t("import.progress", { phase, done: loaded, total }) : phase);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setProgress(t("import.starting"));
    try {
      const typed = token.trim();
      const normalized = normalizeGitToken(typed);
      if (typed !== "" && normalized === null) {
        setProgress(t("import.tokenInvalid"));
        return;
      }
      // Real git when this deployment serves the proxy (full history, keeps .git); the
      // REST importer stays the fallback for a static host with no proxy (D-073/D-079).
      // No host picker: the URL names the host, and a bare owner/repo is GitHub (the
      // common case), so there is nothing for the user to choose (D-079).
      const provider = providerForInput(repo.trim());
      let ok = false;
      const cloneUrl = toCloneUrl(repo.trim(), provider);
      if (cloneUrl !== null && (await gitAvailable())) {
        ok = await c.projectImport.cloneGitRepo(cloneUrl, {
          credentials: normalized === null ? undefined : { token: normalized },
          onProgress: onCloneProgress,
        });
      }
      // No proxy (or a clone that failed once the proxy answered) keeps today's REST
      // importer: cloneGitRepo's own toast explains the failed attempt, then this runs.
      if (!ok) {
        ok = await c.importGitRepo(repo.trim(), { onProgress, provider, token: normalized });
      }
      if (ok) c.closeImportRemote();
    } catch (err) {
      setProgress(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) c.closeImportRemote();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("import.title")}</DialogTitle>
          <DialogDescription>
            {t(realGit ? "import.descriptionGit" : "import.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("import.repository")}
            </span>
            <Input
              autoFocus
              value={repo}
              onChange={(event) => setRepo(event.target.value)}
              placeholder={t("import.repositoryPlaceholder")}
              disabled={busy}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
            />
            <span className="text-xs text-muted-foreground">
              {t(realGit ? "import.repositoryHintGit" : "import.repositoryHint")}
            </span>
            {realGit && (
              <span className="text-xs text-muted-foreground">{t("import.cloneHint")}</span>
            )}
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("import.token")}</span>
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={t("import.tokenPlaceholder")}
              disabled={busy}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
            />
            <span className="text-xs text-muted-foreground">{t("import.tokenHint")}</span>
            <TokenHelp />
          </label>
        </div>

        {progress && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {busy && <Loader className="size-3.5 animate-spin" />}
            <span className="truncate">{progress}</span>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => c.closeImportRemote()} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {busy && <Loader className="size-4 animate-spin" />} {t("import.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
