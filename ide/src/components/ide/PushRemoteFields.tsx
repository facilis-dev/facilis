import type { ChangeEvent, ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { GIT_PROVIDERS, type GitProvider } from "@/vv/git-provider";

const SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground outline-none focus-visible:border-ring";

function Field(props: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{props.label}</span>
      {props.children}
      {props.hint !== undefined && (
        <span className="text-xs text-muted-foreground">{props.hint}</span>
      )}
    </label>
  );
}

export interface PushRemoteFieldsProps {
  provider: GitProvider;
  repository: string;
  token: string;
  tokenInvalid: boolean;
  createBranch: boolean;
  branch: string;
  message: string;
  authorName: string;
  authorEmail: string;
  busy: boolean;
  onProvider: (provider: GitProvider) => void;
  onRepository: (event: ChangeEvent<HTMLInputElement>) => void;
  onToken: (event: ChangeEvent<HTMLInputElement>) => void;
  onCreateBranch: (createBranch: boolean) => void;
  onBranch: (event: ChangeEvent<HTMLInputElement>) => void;
  onMessage: (event: ChangeEvent<HTMLInputElement>) => void;
  onAuthorName: (event: ChangeEvent<HTMLInputElement>) => void;
  onAuthorEmail: (event: ChangeEvent<HTMLInputElement>) => void;
}

/**
 * The publish dialog's form. Props-in/props-out: every edit is reported to the dialog,
 * which owns the plan invalidation and the token's lifetime (D-078).
 */
export function PushRemoteFields(props: PushRemoteFieldsProps) {
  const busy = props.busy;
  return (
    <div className="flex flex-col gap-3">
      <Field label={t("push.host")}>
        <select
          className={SELECT_CLASS}
          value={props.provider}
          onChange={(event) => props.onProvider(event.target.value as GitProvider)}
          disabled={busy}
        >
          {GIT_PROVIDERS.map((host) => (
            <option key={host.id} value={host.id}>
              {host.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label={t("push.repository")} hint={t("push.repositoryHint")}>
        <Input
          autoFocus
          value={props.repository}
          onChange={props.onRepository}
          placeholder={t("push.repositoryPlaceholder")}
          disabled={busy}
        />
      </Field>

      <Field label={t("push.token")} hint={t("push.tokenHint")}>
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={props.token}
          onChange={props.onToken}
          placeholder={t("push.tokenPlaceholder")}
          disabled={busy}
        />
      </Field>
      {props.tokenInvalid && (
        <div className="text-xs text-destructive">{t("push.tokenInvalid")}</div>
      )}

      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-primary"
          checked={props.createBranch}
          disabled={busy}
          onChange={(event) => props.onCreateBranch(event.target.checked)}
        />
        <span>{t("push.createBranch")}</span>
      </label>

      <Field
        label={props.createBranch ? t("push.newBranchName") : t("push.branch")}
        hint={t("push.branchHint")}
      >
        <Input
          value={props.branch}
          onChange={props.onBranch}
          placeholder={t("push.branchPlaceholder")}
          disabled={busy}
        />
      </Field>

      <Field label={t("push.message")}>
        <Input value={props.message} onChange={props.onMessage} disabled={busy} />
      </Field>

      <Field label={t("push.author")} hint={t("push.authorHint")}>
        <div className="flex gap-2">
          <Input
            value={props.authorName}
            onChange={props.onAuthorName}
            placeholder={t("push.authorName")}
            aria-label={t("push.authorName")}
            disabled={busy}
          />
          <Input
            type="email"
            value={props.authorEmail}
            onChange={props.onAuthorEmail}
            placeholder={t("push.authorEmail")}
            aria-label={t("push.authorEmail")}
            disabled={busy}
          />
        </div>
      </Field>
    </div>
  );
}
