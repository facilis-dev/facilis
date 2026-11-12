import { Link, Outlet } from "react-router-dom";
import { LocaleSwitch } from "../components/locale-switch.tsx";
import { Logo } from "../components/logo.tsx";
import { SiteFooter } from "../components/site-footer.tsx";
import { SiteNav } from "../components/site-nav.tsx";
import { ThemeToggle } from "../components/theme-toggle.tsx";
import { buttonClass } from "../components/ui/button.tsx";
import { t } from "../lib/i18n.tsx";
import { cn } from "../lib/utils.ts";

/** The site shell: sticky header with the shared controls, then the routed page and footer. */
export function SiteLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-5">
          <Link aria-label={t("app.title")} to="/">
            <Logo />
          </Link>
          <SiteNav ariaLabel={t("nav.primary")} className="hidden items-center gap-1 md:flex" />
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <LocaleSwitch />
            <Link
              className={buttonClass({ size: "sm", className: "ml-1 hidden sm:inline-flex" })}
              to="/contact"
            >
              {t("nav.contact")}
            </Link>
          </div>
        </div>
        <SiteNav
          ariaLabel={t("nav.primary")}
          className={cn(
            "flex items-center gap-1 overflow-x-auto border-t border-border px-3 py-2 md:hidden",
          )}
        />
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
