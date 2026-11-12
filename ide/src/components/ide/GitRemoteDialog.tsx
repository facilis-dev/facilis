import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
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
import { t, type MessageKey } from "@/i18n";
import type { Credentials } from "@/vv/git-remote";
import { gitRemoteUi } from "@/vv/git-remote-ui";
import { githubSessionToken } from "@/vv/github-oauth";
import { gitAuthTarget, hostOfGitInput } from "@/vv/git-provider";
import { GitAuthPanel, GitProviderLine } from "./GitAuthPanel";

// The session reports a machine phase; the dialog owns what the user reads. Both the
// short names the session emits and the longer forms of the D-079 contract are mapped.
const PHASE_KEYS: Record<string, MessageKey> = {
  detect: "gitRemote.detecting",
  detecting: "gitRemote.detecting",
  fetch: "gitRemote.fetching",
  fetching: "gitRemote.fetching",
  pull: "gitRemote.pulling",
  pulling: "gitRemote.pulling",
  push: "gitRemote.pushing",
  pushing: "gitRemote.pushing",
};

/**
 * Real git over the deployment's stateless proxy (D-079): the open project's remote,
 * with fetch/pull/push. The token is the only secret here — component state only, never
 * stored, cleared when the dialog closes and after each completed operation.
 */
export function GitRemoteDialog() {
  const { c, snap } = useIde();
  const { open } = useSyncExternalStore(gitRemoteUi.subscribe, gitRemoteUi.getSnapshot);
  const state = useSyncExternalStore(c.gitRemote.subscribe, c.gitRemote.getSnapshot);
  const [remote, setRemote] = useState("");
  const [edited, setEdited] = useState(false);
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");

  const root = snap.workspaceFolders.find((f) => f.id === snap.activeFolderId)?.rootPath ?? null;

  useEffect(() => {
    if (!open) {
      // A close must never keep the secret (or the previous project's URL).
      setToken("");
      setUsername("");
      setEdited(false);
      setRemote("");
      return;
    }
    if (root !== null && snap.kernelReady) void c.gitRemote.detect(root);
  }, [open, root, snap.kernelReady, c]);

  // Follow the session's remote until the user starts editing the field.
  useEffect(() => {
    if (open && !edited) setRemote(state.url ?? "");
  }, [open, state.url, edited]);

  if (!open) return null;

  // Until the session has read this root the proxy is still unknown: show progress
  // instead of flashing "unavailable" on the first paint.
  const pending = root !== null && snap.kernelReady && state.root !== root;
  const blocking =
    root === null
      ? t("gitRemote.openProjectFirst")
      : !snap.kernelReady
        ? t("gitRemote.kernelStarting")
        : null;
  const unavailable = state.proxy === null || !state.available;
  const ready = blocking === null && !pending && !unavailable;
  const busy = state.busy;
  const hasRemote = state.url !== null;
  const phaseKey = PHASE_KEYS[state.phase] ?? null;
  const aheadBehind =
    state.ahead === 0 && state.behind === 0
      ? t("gitRemote.upToDate")
      : t("gitRemote.aheadBehind", { ahead: state.ahead, behind: state.behind });
  // A field left empty falls back to the tab's GitHub sign-in (D-082). Operations
  // keep clearing the field, so the token itself is never shown after use.
  const effectiveToken = token.trim() !== "" ? token.trim() : (githubSessionToken() ?? "");
  // The typed URL names the host first (the flow is URL → provider → auth); the saved
  // remote stands in until the field is filled. GitHub takes the device flow, the rest a token.
  const authSource = remote.trim() !== "" ? remote : (state.url ?? "");
  const authTarget = gitAuthTarget(authSource);
  const authHost = hostOfGitInput(authSource);
  const credentials = (): Credentials | undefined => {
    if (effectiveToken === "") return undefined;
    const name = username.trim();
    return name === "" ? { token: effectiveToken } : { token: effectiveToken, username: name };
  };

  const saveRemote = async () => {
    if (root === null || busy || remote.trim() === "") return;
    if (await c.gitRemote.setRemote(root, remote.trim())) {
      setEdited(false);
      toast.success(t("gitRemote.saved"));
    }
  };

  const runFetch = async () => {
    if (root === null || !ready) return;
    if (await c.gitRemote.fetch(root, credentials())) {
      toast.success(t("gitRemote.successFetched"));
      setToken("");
    }
  };
  const runPull = async () => {
    if (root === null || !ready) return;
    if (await c.gitRemote.pull(root, credentials())) {
      toast.success(t("gitRemote.successPulled"));
      setToken("");
    }
  };
  const runPush = async () => {
    if (root === null || !ready) return;
    const creds = credentials();
    if (creds === undefined) return;
    if (await c.gitRemote.push(root, creds)) {
      toast.success(t("gitRemote.successPushed"));
      setToken("");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) gitRemoteUi.close();
      }}
    >
      <DialogContent showCloseButton={!busy} className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("gitRemote.title")}</DialogTitle>
          <DialogDescription>{t("gitRemote.description")}</DialogDescription>
        </DialogHeader>

        {blocking !== null ? (
          <div className="text-xs text-muted-foreground">{blocking}</div>
        ) : pending ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader className="size-3.5 animate-spin" />
            <span>{t("gitRemote.detecting")}</span>
          </div>
        ) : unavailable ? (
          <div className="text-xs text-muted-foreground">{t("gitRemote.unavailable")}</div>
        ) : (
          <div className="flex flex-col gap-3">
            {!hasRemote && (
              <div className="text-xs text-muted-foreground">{t("gitRemote.notRepository")}</div>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t("gitRemote.remote")}
              </span>
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={remote}
                  onChange={(event) => {
                    setRemote(event.target.value);
                    setEdited(true);
                  }}
                  placeholder={t("gitRemote.remotePlaceholder")}
                  spellCheck={false}
                  disabled={busy}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void saveRemote();
                  }}
                />
                <Button
                  variant="outline"
                  onClick={() => void saveRemote()}
                  disabled={busy || remote.trim() === ""}
                >
                  {state.phase === "set-remote" && <Loader className="size-4 animate-spin" />}
                  {t("gitRemote.save")}
                </Button>
              </div>
              {!hasRemote && (
                <span className="text-xs text-muted-foreground">
                  {t("gitRemote.remotePlaceholder")}
                </span>
              )}
            </label>

            <GitProviderLine target={authTarget} host={authHost} />

            <GitAuthPanel
              target={authTarget}
              token={token}
              username={username}
              busy={busy}
              onToken={setToken}
              onUsername={setUsername}
              write
            />

            {hasRemote && (
              <>
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    {t("gitRemote.branch") + ": "}
                    <span className="text-foreground">{state.branch ?? "—"}</span>
                  </span>
                  <span className="tabular-nums">{aheadBehind}</span>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => void runFetch()} disabled={busy}>
                    {busy && phaseKey === "gitRemote.fetching" && (
                      <Loader className="size-4 animate-spin" />
                    )}
                    {t("gitRemote.fetch")}
                  </Button>
                  <Button variant="outline" onClick={() => void runPull()} disabled={busy}>
                    {busy && phaseKey === "gitRemote.pulling" && (
                      <Loader className="size-4 animate-spin" />
                    )}
                    {t("gitRemote.pull")}
                  </Button>
                  <Button
                    onClick={() => void runPush()}
                    disabled={busy || state.branch === null || effectiveToken === ""}
                  >
                    {busy && phaseKey === "gitRemote.pushing" && (
                      <Loader className="size-4 animate-spin" />
                    )}
                    {t("gitRemote.push")}
                  </Button>
                </div>

                {busy && phaseKey !== null && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader className="size-3.5 animate-spin" />
                    <span className="truncate">{t(phaseKey)}</span>
                  </div>
                )}
              </>
            )}

            {state.error !== null && <div className="text-xs text-destructive">{state.error}</div>}
          </div>
        )}

        <DialogFooter>
          <span className="mr-auto text-xs text-muted-foreground">{t("gitRemote.pullHint")}</span>
          <Button
            variant="outline"
            onClick={() => {
              if (!busy) gitRemoteUi.close();
            }}
            disabled={busy}
          >
            {t("common.cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
