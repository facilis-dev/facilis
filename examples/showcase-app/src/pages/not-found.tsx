import { Link } from "react-router-dom";
import { buttonClass } from "../components/ui/button.tsx";
import { t } from "../lib/i18n.tsx";

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 bg-primary px-6 py-20 text-center text-primary-foreground">
      <Link className="font-serif text-lg font-semibold tracking-tight" to="/">
        {t("app.title")}
      </Link>
      <p aria-hidden="true" className="font-serif text-8xl leading-none opacity-90">
        404
      </p>
      <div className="flex max-w-md flex-col gap-3">
        <h1 className="font-serif text-3xl tracking-tight text-balance">{t("notfound.title")}</h1>
        <p className="leading-relaxed text-primary-foreground/70">{t("notfound.description")}</p>
      </div>
      <Link className={buttonClass({ variant: "accent" })} to="/">
        {t("notfound.action")}
      </Link>
    </main>
  );
}
