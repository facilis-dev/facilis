import { t } from "@/i18n";

// Where each host mints a token, and the scope the operation needs (D-073/D-079).
const TOKEN_URLS: Record<"github" | "gitlab" | "gitea", string> = {
  github: "https://github.com/settings/tokens",
  gitlab: "https://gitlab.com/-/user_settings/personal_access_tokens",
  gitea: "https://docs.gitea.com/next/development/api-usage#generating-and-listing-api-tokens",
};

function Row(props: { host: "github" | "gitlab" | "gitea"; label: string; line: string }) {
  return (
    <li>
      <a
        className="underline underline-offset-2"
        href={TOKEN_URLS[props.host]}
        target="_blank"
        rel="noreferrer"
      >
        {props.label}
      </a>
      {" — " + props.line}
    </li>
  );
}

/**
 * A collapsed "how to create a token" block. It lives in its own component because the
 * import, publish and remote dialogs all ask for a token and the scope differs between a
 * read (import/fetch) and a write (publish/push) operation — the sentence is per host so
 * the user is not sent to the wrong settings page.
 */
export function TokenHelp(props: { write?: boolean }) {
  const write = props.write === true;
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none">{t("token.helpSummary")}</summary>
      <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
        <Row
          host="github"
          label="GitHub"
          line={t("token.githubLine", {
            scope: t(write ? "token.scopeGithubWrite" : "token.scopeGithubRead"),
          })}
        />
        <Row
          host="gitlab"
          label="GitLab"
          line={t("token.gitlabLine", {
            scope: t(write ? "token.scopeGitlabWrite" : "token.scopeGitlabRead"),
          })}
        />
        <Row
          host="gitea"
          label="Gitea / Forgejo"
          line={t("token.giteaLine", {
            scope: t(write ? "token.scopeGiteaWrite" : "token.scopeGiteaRead"),
          })}
        />
      </ul>
    </details>
  );
}
