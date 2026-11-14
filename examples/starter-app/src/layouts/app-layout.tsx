import { Link, Outlet } from "react-router-dom";
import { t } from "@facilis.dev/core/i18n";
import { IconLogOut } from "../components/icons.tsx";
import { Button } from "../components/ui/button.tsx";
import { LocaleSwitch } from "../components/locale-switch.tsx";
import { ThemeToggle } from "../components/theme-toggle.tsx";
import { useSession } from "../lib/session.tsx";

/**
 * Project-owned app shell: brand, the cross-cutting controls and the session's logout. The
 * components are copied into the project, so the layout is plain utilities over the shared
 * role tokens; grow the navigation here instead of adding a second shell.
 */
export function AppLayout() {
  const { session, logout } = useSession();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex min-h-[56px] w-full max-w-page flex-wrap items-center gap-3 px-5 py-2 max-[640px]:px-3">
          <Link className="flex min-w-0 items-center gap-2 text-foreground" to="/">
            <span
              className="grid size-8 flex-none place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
              aria-hidden="true"
            >
              F
            </span>
            <span className="truncate text-base font-semibold tracking-tight">
              {t("app.title")}
            </span>
          </Link>
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
        </div>
      </header>
      <main className="mx-auto w-full max-w-page px-5 py-6 max-[1120px]:px-4 max-[640px]:px-3 max-[640px]:py-4">
        <Outlet />
      </main>
    </div>
  );
}
