import { useEffect, useRef } from "react";
import { t } from "@/i18n";

/**
 * The device-flow code and its copy action (issue #219). It replaces the sign-in button,
 * which unmounts: the status region announces the code to assistive technology, and the
 * copy button takes focus so the keyboard is not left on the document.
 */
export function GitHubDeviceCodePanel(props: {
  code: string;
  verificationUri: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const copy = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    copy.current?.focus();
  }, []);
  return (
    <div role="status" data-testid="github-device-code-region" className="flex flex-col gap-2">
      <span className="text-xs text-muted-foreground">{t("github.codeHint")}</span>
      <div className="flex items-center gap-2">
        <code
          data-testid="github-device-code"
          className="self-start rounded bg-muted px-2 py-1 font-mono text-base tracking-widest text-foreground"
        >
          {props.code}
        </code>
        <button
          ref={copy}
          type="button"
          data-testid="github-copy-code"
          className="self-start text-xs text-muted-foreground underline underline-offset-2"
          onClick={props.onCopy}
        >
          {t(props.copied ? "github.copied" : "github.copyCode")}
        </button>
      </div>
      <a
        className="text-xs underline"
        href={props.verificationUri}
        target="_blank"
        rel="noreferrer"
      >
        {t("github.open")}
      </a>
    </div>
  );
}
