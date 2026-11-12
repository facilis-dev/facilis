import { useEffect, useRef, useState } from "react";
import Loader from "~icons/lucide/loader-circle";
import { Button } from "@/components/ui/button";
import { t, type MessageKey } from "@/i18n";
import { deployment, githubOAuthClientId } from "@/deploy/current";
import { proxyBase } from "@/vv/git-remote";
import {
  GitHubOAuthError,
  githubSessionToken,
  setGitHubSessionToken,
  signInWithGitHub,
  type GitHubDeviceCode,
} from "@/vv/github-oauth";

const ERROR_KEYS: Record<string, MessageKey> = {
  denied: "github.denied",
  expired: "github.expired",
  network: "github.network",
  invalid: "github.invalid",
  unavailable: "github.unavailable",
};

/**
 * "Sign in with GitHub" for the git dialogs (D-082). It is an alternative to pasting
 * a token: the device flow runs on github.com (which is where 2FA lives), and the
 * resulting token is kept in this tab's memory only. Renders nothing unless the
 * deployment configured an OAuth app and the proxy exists.
 */
export function GitHubSignIn(props: {
  onToken: (token: string | null) => void;
  /** The main call to action of the dialog (the git auth panel); secondary elsewhere. */
  prominent?: boolean;
}) {
  const prominent = props.prominent === true;
  const clientId = githubOAuthClientId(deployment);
  const base = proxyBase();
  const [phase, setPhase] = useState<"idle" | "starting" | "waiting" | "error">("idle");
  const [deviceCode, setDeviceCode] = useState<GitHubDeviceCode | null>(null);
  const [errorKey, setErrorKey] = useState<MessageKey>("github.invalid");
  const [signedIn, setSignedIn] = useState(() => githubSessionToken() !== null);
  const controller = useRef<AbortController | null>(null);

  // Closing the dialog unmounts the component: an in-flight poll must stop.
  useEffect(() => () => controller.current?.abort(), []);

  if (clientId === null || base === null) return null;

  const start = async () => {
    setPhase("starting");
    setDeviceCode(null);
    setErrorKey("github.invalid");
    const abort = new AbortController();
    controller.current = abort;
    try {
      const token = await signInWithGitHub({
        base,
        clientId,
        signal: abort.signal,
        onCode: (code) => {
          setDeviceCode(code);
          setPhase("waiting");
        },
      });
      setGitHubSessionToken(token);
      setSignedIn(true);
      setPhase("idle");
      setDeviceCode(null);
      props.onToken(token);
    } catch (error) {
      if (abort.signal.aborted) {
        setPhase("idle");
        setDeviceCode(null);
        return;
      }
      setErrorKey(
        error instanceof GitHubOAuthError
          ? (ERROR_KEYS[error.code] ?? "github.invalid")
          : "github.invalid",
      );
      setPhase("error");
    } finally {
      controller.current = null;
    }
  };

  const cancel = () => {
    controller.current?.abort();
    setPhase("idle");
    setDeviceCode(null);
  };

  const signOut = () => {
    setGitHubSessionToken(null);
    setSignedIn(false);
    props.onToken(null);
  };

  if (signedIn) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5">
        <span className="text-xs text-muted-foreground">{t("github.signedIn")}</span>
        <Button variant="ghost" size="sm" onClick={signOut}>
          {t("github.signOut")}
        </Button>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border p-2">
        <span className="text-xs text-destructive">{t(errorKey)}</span>
        <Button variant="outline" size="sm" onClick={() => void start()}>
          {t("github.retry")}
        </Button>
      </div>
    );
  }

  if (phase === "starting" || phase === "waiting") {
    return (
      <div className="flex flex-col gap-2 rounded-md border border-border p-2">
        {deviceCode === null ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader className="size-3.5 animate-spin" />
            {t("github.contacting")}
          </div>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">{t("github.codeHint")}</span>
            <code className="self-start rounded bg-muted px-2 py-1 font-mono text-base tracking-widest text-foreground">
              {deviceCode.userCode}
            </code>
            <a
              className="text-xs underline"
              href={deviceCode.verificationUri}
              target="_blank"
              rel="noreferrer"
            >
              {t("github.open")}
            </a>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader className="size-3.5 animate-spin" />
              {t("github.waiting")}
            </div>
          </>
        )}
        <Button variant="outline" size="sm" onClick={cancel}>
          {t("github.cancel")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Button
        variant={prominent ? "default" : "outline"}
        size={prominent ? "lg" : "sm"}
        className={prominent ? "w-full" : undefined}
        onClick={() => void start()}
      >
        {t("github.signIn")}
      </Button>
      <span className="text-xs text-muted-foreground">{t("github.hint")}</span>
    </div>
  );
}
