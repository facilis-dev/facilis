import { Link, Outlet } from "react-router-dom";
import { DocsSidebar } from "../components/docs-sidebar.tsx";
import { LocaleSwitch } from "../components/locale-switch.tsx";
import { Logo } from "../components/logo.tsx";
import { SiteFooter } from "../components/site-footer.tsx";
import { SiteNav } from "../components/site-nav.tsx";
import { ThemeToggle } from "../components/theme-toggle.tsx";
import { t } from "../lib/i18n.tsx";

/**
 * The docs shell: sticky header, the content-tree sidebar, the routed page and the footer.
 * The sidebar is sticky on large screens; small screens get the same tree in a native
 * details block above the page, so navigation never needs client state to work.
 */
export function DocsLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-6 px-5">
          <Link aria-label={t("app.title")} to="/">
            <Logo />
          </Link>
          <SiteNav ariaLabel={t("nav.primary")} className="hidden items-center gap-1 md:flex" />
          <div className="ml-auto flex items-center gap-1.5">
            <ThemeToggle />
            <LocaleSwitch />
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-7xl flex-1 items-start gap-10 px-5">
        <aside className="sticky top-16 hidden max-h-[calc(100vh-4rem)] w-64 shrink-0 overflow-y-auto py-10 lg:block">
          <DocsSidebar />
        </aside>
        <main className="min-w-0 flex-1 py-10">
          <details className="mb-8 rounded-lg border border-border p-4 lg:hidden">
            <summary className="cursor-pointer text-sm font-medium select-none">
              {t("sidebar.browse")}
            </summary>
            <div className="mt-3">
              <DocsSidebar />
            </div>
          </details>
          <Outlet />
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}
