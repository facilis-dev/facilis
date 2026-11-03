import type { ReactNode } from "react";
import { t } from "@facilis/core/i18n";

const POINTS = ["auth.brand.point1", "auth.brand.point2", "auth.brand.point3"] as const;

/**
 * Split auth shell: a calm A-token brand panel beside the auth card. It hides below 1024px so
 * the card stands alone on narrow screens; the brand layer is still undecided, so this uses the
 * operations tokens only.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-1 bg-background min-[1024px]:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <aside
        className="hidden flex-col justify-between gap-10 border-r border-border bg-card p-10 min-[1024px]:flex"
        aria-label={t("auth.brand.eyebrow")}
      >
        <p className="flex items-center gap-2 text-foreground">
          <span
            className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground"
            aria-hidden="true"
          >
            F
          </span>
          <span className="text-base font-semibold tracking-tight">{t("app.title")}</span>
        </p>
        <div className="flex max-w-md flex-col gap-4">
          <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {t("auth.brand.eyebrow")}
          </p>
          <p className="text-3xl leading-tight font-semibold tracking-[-0.02em]">
            {t("auth.brand.title")}
          </p>
          <ul className="flex flex-col gap-3">
            {POINTS.map((key) => (
              <li key={key} className="flex items-start gap-3 text-sm text-muted-foreground">
                <span
                  className="mt-1.5 size-1.5 flex-none rounded-full bg-accent"
                  aria-hidden="true"
                />
                {t(key)}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-muted-foreground">{t("auth.brand.foot")}</p>
      </aside>
      <div className="flex flex-col justify-center px-4 py-6 min-[1024px]:px-8">{children}</div>
    </div>
  );
}
