import type { ReactNode } from "react";
import { t } from "@facilis/core/i18n";

const POINTS = ["auth.brand.point1", "auth.brand.point2", "auth.brand.point3"] as const;

/**
 * Split auth shell: a calm A-token brand panel beside the kit AuthShell card. It hides below
 * 1024px so the card stands alone on narrow screens; the brand layer is still undecided, so this
 * uses the operations tokens only.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="app-auth">
      <aside className="app-auth__brand" aria-label={t("auth.brand.eyebrow")}>
        <p className="app-brand">
          <span className="app-logo" aria-hidden="true">
            F
          </span>
          <span className="app-brand__name">{t("app.title")}</span>
        </p>
        <div className="app-auth__body">
          <p className="app-auth__eyebrow">{t("auth.brand.eyebrow")}</p>
          <p className="app-auth__title">{t("auth.brand.title")}</p>
          <ul className="app-auth__points">
            {POINTS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </div>
        <p className="app-auth__foot">{t("auth.brand.foot")}</p>
      </aside>
      <div className="app-auth__panel">{children}</div>
    </div>
  );
}
