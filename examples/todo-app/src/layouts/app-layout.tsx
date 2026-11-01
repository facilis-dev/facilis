import { Link, NavLink, Outlet } from "react-router-dom";
import { Avatar, Button } from "@facilis/ui";
import { t } from "@facilis/core/i18n";
import { IconList, IconLogOut } from "../components/icons.tsx";
import { LocaleSwitch } from "../components/locale-switch.tsx";
import { ThemeToggle } from "../components/theme-toggle.tsx";
import { rememberedEmail, useSession } from "../lib/session.tsx";

/**
 * Project-owned A shell: sidebar (brand, workspace nav, identity footer) plus a topbar with page
 * context and the cross-cutting controls. Navigation knows the router, so it stays in the app;
 * the kit only owns the controls and surfaces (D-050/D-051).
 */
export function AppLayout() {
  const { session, logout } = useSession();
  const email = rememberedEmail();
  const identity = email ?? t("nav.account");

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link className="app-brand" to="/todos">
          <span className="app-logo" aria-hidden="true">
            F
          </span>
          <span className="app-brand__name">{t("app.title")}</span>
        </Link>
        <nav className="app-nav" aria-label={t("nav.primary")}>
          <p className="app-nav__label">{t("nav.workspace")}</p>
          <NavLink className="app-nav__item" to="/todos">
            <IconList />
            <span>{t("nav.todos")}</span>
          </NavLink>
        </nav>
        <div className="app-sidebar__foot">
          <Avatar name={identity} size="sm" />
          <div className="app-sidebar__user">
            <p className="app-sidebar__name">{identity}</p>
          </div>
        </div>
      </aside>
      <div className="app-frame">
        <header className="app-topbar">
          <nav className="app-breadcrumb" aria-label={t("nav.breadcrumb")}>
            <span>{t("nav.workspace")}</span>
            <span className="app-breadcrumb__sep" aria-hidden="true">
              /
            </span>
            <span aria-current="page">{t("nav.todos")}</span>
          </nav>
          <div className="app-tools">
            <ThemeToggle />
            <LocaleSwitch />
            {session?.authenticated === true ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("auth.logout")}
                onClick={() => void logout()}
              >
                <IconLogOut />
                <span>{t("auth.logout")}</span>
              </Button>
            ) : null}
          </div>
        </header>
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
