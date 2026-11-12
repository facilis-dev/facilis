import { Link } from "react-router-dom";
import { t } from "../lib/i18n.tsx";
import { NAV_ITEMS } from "../lib/navigation.ts";
import { Logo } from "./logo.tsx";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-secondary/40">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-14 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-4 sm:col-span-2">
          <Logo />
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            {t("footer.tagline")}
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {t("footer.nav")}
          </p>
          <ul className="flex flex-col gap-2 text-sm">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <Link
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  to={item.to}
                >
                  {t(item.key)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3">
          <p className="text-xs font-semibold tracking-[0.16em] text-muted-foreground uppercase">
            {t("footer.contact")}
          </p>
          <a
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            href="mailto:hello@vetrina.studio"
          >
            {t("footer.email")}
          </a>
          <p className="text-sm text-muted-foreground">{t("contact.info.address.value")}</p>
        </div>
      </div>
      <div className="border-t border-border">
        <p className="mx-auto w-full max-w-6xl px-5 py-5 text-xs text-muted-foreground">
          {t("footer.rights", { year })}
        </p>
      </div>
    </footer>
  );
}
