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
  GIT_PROVIDERS,
  detectGitProvider,
  hostOfGitInput,
  normalizeGitToken,
  type GitProvider,
} from "@/vv/git-provider";

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring";

// Import a project from a git host (GitHub, GitLab, Gitea/Forgejo).
// Snapshot-driven (c.openImportRemote / c.closeImportRemote) so it works from Home and the
// command palette alike. A private repository's token lives only in this component: it is
// handed to the importer and dropped when the dialog closes (D-073).
export function ImportRemoteDialog() {
  const { c, snap } = useIde();
  const open = snap.importRemoteOpen;
  const [provider, setProvider] = useState<GitProvider>("github");
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

  const canSubmit = !!repo.trim() && !busy && snap.kernelReady;

  const onProgress = (done: number, total: number, phase: string) => {
    setProgress(total > 0 ? t("import.progress", { phase, done, total }) : phase);
  };

  // A URL names its host: follow it, but leave the picker authoritative for self-hosted
  // servers whose hostname says nothing (git.company.com can be either).
  const chooseRepo = (next: string) => {
    setRepo(next);
    const host = hostOfGitInput(next);
    const detected = host === null ? null : detectGitProvider(host);
    if (detected !== null) setProvider(detected);
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
      const ok = await c.importGitRepo(repo.trim(), { onProgress, provider, token: normalized });
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
          <DialogDescription>{t("import.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("import.host")}</span>
            <select
              className={SELECT_CLASS}
              value={provider}
              onChange={(event) => setProvider(event.target.value as GitProvider)}
              disabled={busy}
            >
              {GIT_PROVIDERS.map((host) => (
                <option key={host.id} value={host.id}>
                  {host.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">
              {t("import.repository")}
            </span>
            <Input
              autoFocus
              value={repo}
              onChange={(event) => chooseRepo(event.target.value)}
              placeholder={t("import.repositoryPlaceholder")}
              disabled={busy}
              onKeyDown={(event) => {
                if (event.key === "Enter") void submit();
              }}
            />
            <span className="text-xs text-muted-foreground">{t("import.repositoryHint")}</span>
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
