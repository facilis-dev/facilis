import { Link } from "react-router-dom";
import { t } from "@facilis.dev/core/i18n";
import { buttonVariants } from "../components/ui/button.tsx";
import { Page } from "../components/ui/page.tsx";

/** The catch-all route has no layout, so it centres its own Page container. */
export function NotFoundPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[80rem] flex-col justify-center px-4 py-8">
      <Page title={t("not_found.title")}>
        <p className="text-sm text-muted-foreground">{t("not_found.description")}</p>
        <Link className={buttonVariants({ className: "w-fit" })} to="/">
          {t("not_found.action")}
        </Link>
      </Page>
    </div>
  );
}
