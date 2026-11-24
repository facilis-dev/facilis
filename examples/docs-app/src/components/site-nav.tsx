import { NavLink } from "react-router-dom";
import { t } from "../lib/i18n.tsx";
import { NAV_ITEMS } from "../lib/navigation.ts";
import { cn } from "../lib/utils.ts";

type SiteNavProps = { ariaLabel: string; className?: string };

/** Renders the one navigation list in a shared style; the caller places it. */
export function SiteNav({ ariaLabel, className }: SiteNavProps) {
  return (
    <nav aria-label={ariaLabel} className={className}>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end
          className={({ isActive }) =>
            cn(
              "rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )
          }
        >
          {t(item.key)}
        </NavLink>
      ))}
    </nav>
  );
}
