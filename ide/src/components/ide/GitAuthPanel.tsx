import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { t, type MessageKey } from "@/i18n";
import { deployment, githubOAuthClientId } from "@/deploy/current";
import { proxyBase } from "@/vv/git-remote";
import { GIT_PROVIDERS, type GitAuthTarget, type GitProvider } from "@/vv/git-provider";
import { GitHubSignIn } from "./GitHubSignIn";
import { TokenHelp } from "./TokenHelp";

/** Brand names are not translated (D-069); the ids keep the label in one place. */
function providerLabel(provider: GitProvider): string {
  return GIT_PROVIDERS.find((entry) => entry.id === provider)?.label ?? provider;
}

/** The detected provider, so the fields below are obviously the right ones. */
export function GitProviderLine(props: { target: GitAuthTarget | null; host: string | null }) {
  if (props.target === null) return null;
  const provider = props.target.kind === "github" ? "github" : props.target.provider;
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span>{t("gitAuth.provider")}</span>
      <span className="rounded-sm bg-muted px-1.5 py-0.5 font-medium text-foreground">
        {provider === null ? t("gitAuth.otherHost") : providerLabel(provider)}
      </span>
      {provider === null && props.host !== null && (
        <span className="truncate">{t("gitAuth.host", { host: props.host })}</span>
      )}
    </div>
  );
}

const TOGGLE_CLASS = "self-start text-xs text-muted-foreground underline underline-offset-2";

/** The token field with its explanation, for the states where it is the only credential. */
function TokenField(props: {
  value: string;
  hint: string;
  disabled: boolean;
  write: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{t("gitAuth.tokenLabel")}</span>
      <Input
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={t("gitAuth.tokenPlaceholder")}
        disabled={props.disabled}
      />
      <span className="text-xs text-muted-foreground">{props.hint}</span>
      <TokenHelp write={props.write} />
    </label>
  );
}

/**
 * Where the user authenticates, picked from the pasted reference (D-082): GitHub gets its
 * device flow as the main action with a token as a small fallback; every other host gets
 * a token, with username + password as the opt-in alternative (the username is the
 * switch, D-081). The values live in the dialog, not here.
 */
export function GitAuthPanel(props: {
  target: GitAuthTarget | null;
  token: string;
  username: string;
  busy: boolean;
  onToken: (value: string) => void;
  onUsername: (value: string) => void;
  /** The token needs write access (a push), not just read (an import). */
  write?: boolean;
}) {
  const [tokenFallback, setTokenFallback] = useState(false);
  const [passwordMode, setPasswordMode] = useState(false);
  const targetKind = props.target?.kind ?? null;
  const write = props.write === true;
  const tokenHint: MessageKey = write ? "gitAuth.tokenHintWrite" : "gitAuth.tokenHint";

  // A username only means "password" for a non-GitHub host: a stale one from an earlier
  // URL must not turn a GitHub token into a password (D-081).
  useEffect(() => {
    if (targetKind === "github" && props.username !== "") props.onUsername("");
  }, [targetKind, props.username, props.onUsername]);

  if (props.target === null) {
    return <p className="text-xs text-muted-foreground">{t("gitAuth.hintEmpty")}</p>;
  }

  if (props.target.kind === "github") {
    // The device flow needs this deployment's OAuth app and proxy: without them the token
    // is the only credential, so it takes the main slot instead of being a fallback.
    const signInAvailable = githubOAuthClientId(deployment) !== null && proxyBase() !== null;
    return (
      <div className="flex flex-col gap-2">
        {signInAvailable ? (
          <>
            <GitHubSignIn
              prominent
              onToken={(value) => {
                props.onToken(value ?? "");
                props.onUsername("");
              }}
            />
            <button
              type="button"
              className={TOGGLE_CLASS}
              onClick={() => setTokenFallback((open) => !open)}
            >
              {t(tokenFallback ? "gitAuth.githubInstead" : "gitAuth.tokenInstead")}
            </button>
            {tokenFallback && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("gitAuth.tokenLabel")}
                </span>
                <Input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={props.token}
                  onChange={(event) => props.onToken(event.target.value)}
                  placeholder={t("gitAuth.tokenPlaceholder")}
                  disabled={props.busy}
                />
              </label>
            )}
          </>
        ) : (
          <>
            <span className="text-xs text-muted-foreground">{t("gitAuth.githubUnavailable")}</span>
            <TokenField
              value={props.token}
              hint={t(tokenHint)}
              disabled={props.busy}
              write={write}
              onChange={props.onToken}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {t(passwordMode ? "gitAuth.passwordLabel" : "gitAuth.tokenLabel")}
        </span>
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={props.token}
          onChange={(event) => props.onToken(event.target.value)}
          placeholder={t(passwordMode ? "gitAuth.passwordPlaceholder" : "gitAuth.tokenPlaceholder")}
          disabled={props.busy}
        />
        <span className="text-xs text-muted-foreground">
          {t(passwordMode ? "gitAuth.passwordHint" : tokenHint)}
        </span>
        {!passwordMode && <TokenHelp write={write} />}
      </label>
      <button
        type="button"
        className={TOGGLE_CLASS}
        onClick={() => {
          setPasswordMode((open) => !open);
          props.onUsername("");
        }}
      >
        {t(passwordMode ? "gitAuth.tokenInstead" : "gitAuth.passwordInstead")}
      </button>
      {passwordMode && (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">
            {t("gitAuth.usernameLabel")}
          </span>
          <Input
            autoComplete="off"
            spellCheck={false}
            value={props.username}
            onChange={(event) => props.onUsername(event.target.value)}
            placeholder={t("gitAuth.usernamePlaceholder")}
            disabled={props.busy}
          />
          <span className="text-xs text-muted-foreground">{t("gitAuth.usernameHint")}</span>
        </label>
      )}
    </div>
  );
}
