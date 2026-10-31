import { Link, Outlet } from "react-router-dom";
import { Button } from "@facilis/ui";
import { t } from "@facilis/core/i18n";
import { LocaleSwitch } from "../components/locale-switch.tsx";
import { ThemeToggle } from "../components/theme-toggle.tsx";
import { useSession } from "../lib/session.tsx";

/**
 * Project-owned shell: navigation and session chrome around the page content. It knows the
 * router and the session, so it stays in the app (neutral templates live in @facilis/ui).
 */
export function AppLayout() {
  const { session, logout } = useSession();

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="app-brand" to="/todos">
          {t("app.title")}
        </Link>
        <nav className="app-nav" aria-label={t("nav.primary")}>
          <Link to="/todos">{t("nav.todos")}</Link>
        </nav>
        <div className="app-tools">
          <ThemeToggle />
          <LocaleSwitch />
          {session?.authenticated === true ? (
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              {t("auth.logout")}
            </Button>
          ) : null}
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
