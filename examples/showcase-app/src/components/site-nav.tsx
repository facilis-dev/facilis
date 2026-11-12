import { NavLink } from "react-router-dom";
import { t } from "../lib/i18n.tsx";
import { NAV_ITEMS } from "../lib/navigation.ts";
import { cn } from "../lib/utils.ts";

type SiteNavProps = { ariaLabel: string; className?: string };

/** Renders the one navigation list in a single visual style, used by the header on both sizes. */
export function SiteNav({ ariaLabel, className }: SiteNavProps) {
  return (
    <nav aria-label={ariaLabel} className={className}>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          className={({ isActive }) =>
            cn(
              "rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              isActive && "bg-secondary font-semibold text-foreground",
            )
          }
        >
          {t(item.key)}
        </NavLink>
      ))}
    </nav>
  );
}
