import { Link } from "react-router-dom";
import { t } from "@facilis.dev/core/i18n";
import { buttonVariants } from "../components/ui/button.tsx";

/**
 * The catch-all route has no layout, so it owns its composition: the code, one heading,
 * one sentence and the action that gets the user back.
 */
export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-page flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <p className="font-mono text-xs tracking-label text-muted-foreground">
        {t("not_found.code")}
      </p>
      <h1 className="font-display text-2xl font-semibold tracking-tight">{t("not_found.title")}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t("not_found.description")}</p>
      <Link className={buttonVariants({ className: "mt-2" })} to="/todos">
        {t("not_found.action")}
      </Link>
    </div>
  );
}
