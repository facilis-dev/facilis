import { Link, NavLink, Outlet } from "react-router-dom";
import { t } from "@facilis.dev/core/i18n";
import { IconList, IconLogOut } from "../components/icons.tsx";
import { Avatar } from "../components/ui/avatar.tsx";
import { Button } from "../components/ui/button.tsx";
import { LocaleSwitch } from "../components/locale-switch.tsx";
import { ThemeToggle } from "../components/theme-toggle.tsx";
import { rememberedEmail, useSession } from "../lib/session.tsx";
import { cn } from "../lib/utils.ts";

/**
 * Project-owned A shell: sidebar (brand, workspace nav, identity footer) plus a topbar with
 * page context and the cross-cutting controls. The components are copied into the project, so
 * the layout is plain utilities over the shared role tokens.
 */
export function AppLayout() {
  const { session, logout } = useSession();
  const email = rememberedEmail();
  const identity = email ?? t("nav.account");

  return (
    <div className="flex min-h-screen bg-background max-[900px]:flex-col">
      <aside className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2 min-[900px]:sticky min-[900px]:top-0 min-[900px]:h-screen min-[900px]:w-[248px] min-[900px]:flex-none min-[900px]:flex-col min-[900px]:flex-nowrap min-[900px]:items-stretch min-[900px]:gap-5 min-[900px]:border-r min-[900px]:border-b-0 min-[900px]:px-3 min-[900px]:pt-4 min-[900px]:pb-3">
        <Link className="flex min-w-0 items-center gap-2 px-2 text-foreground" to="/todos">
          <span
            className="grid size-8 flex-none place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
            aria-hidden="true"
          >
            F
          </span>
          <span className="truncate text-base font-semibold tracking-tight">{t("app.title")}</span>
        </Link>
        <nav
          className="flex flex-row items-center gap-0.5 min-[900px]:flex-col min-[900px]:items-stretch"
          aria-label={t("nav.primary")}
        >
          <p className="hidden px-2 pb-1 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase min-[900px]:block">
            {t("nav.workspace")}
          </p>
          <NavLink
            className={({ isActive }) =>
              cn(
                "flex min-h-[34px] items-center gap-3 rounded-lg px-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                isActive &&
                  "bg-accent font-semibold text-accent-foreground hover:bg-accent hover:text-accent-foreground",
              )
            }
            to="/todos"
          >
            <IconList className="size-4" />
            <span>{t("nav.todos")}</span>
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-2 min-[900px]:mt-auto min-[900px]:ml-0 min-[900px]:border-t min-[900px]:border-border min-[900px]:pt-3">
          <Avatar name={identity} size="sm" />
          <p className="hidden truncate text-sm font-semibold min-[900px]:block">{identity}</p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex min-h-[56px] flex-wrap items-center gap-4 border-b border-border bg-card px-5 py-2 max-[640px]:min-h-[52px] max-[640px]:px-3">
          <nav
            className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground max-[640px]:hidden"
            aria-label={t("nav.breadcrumb")}
          >
            <span>{t("nav.workspace")}</span>
            <span className="opacity-50" aria-hidden="true">
              /
            </span>
            <span className="font-medium text-foreground" aria-current="page">
              {t("nav.todos")}
            </span>
          </nav>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
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
        <main className="mx-auto w-full max-w-page px-5 py-6 max-[1120px]:px-4 max-[640px]:px-3 max-[640px]:py-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
