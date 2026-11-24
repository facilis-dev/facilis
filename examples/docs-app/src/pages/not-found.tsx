import { Link } from "react-router-dom";
import { buttonClass } from "../components/ui/button.tsx";
import { t } from "../lib/i18n.tsx";

/** The catch-all for paths outside the docs tree. */
export function NotFoundPage() {
  return (
    <div className="flex flex-col items-start gap-4 py-10">
      <title>{t("meta.notfound.title")}</title>
      <p className="text-xs font-semibold tracking-[0.18em] text-accent uppercase">
        {t("notfound.eyebrow")}
      </p>
      <h1 className="font-serif text-4xl tracking-tight">{t("notfound.title")}</h1>
      <p className="max-w-lg text-muted-foreground">{t("notfound.body")}</p>
      <Link className={buttonClass({ variant: "outline" })} to="/">
        {t("notfound.back")}
      </Link>
    </div>
  );
}
