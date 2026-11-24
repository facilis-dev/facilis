import { Link } from "react-router-dom";
import { t } from "../lib/i18n.tsx";
import { NAV_ITEMS } from "../lib/navigation.ts";

/** The shared footer: the same navigation list plus the template's rights line. */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-5 py-8 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label={t("footer.nav")} className="flex flex-wrap items-center gap-4">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              to={item.to}
            >
              {t(item.key)}
            </Link>
          ))}
        </nav>
        <p className="text-xs text-muted-foreground">{t("footer.rights", { year })}</p>
      </div>
    </footer>
  );
}
