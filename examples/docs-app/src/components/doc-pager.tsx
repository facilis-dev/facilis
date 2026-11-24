import { ArrowLeft, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import { docPager } from "../lib/docs.ts";
import { t } from "../lib/i18n.tsx";

/** Prev/next links in the content tree's reading order (issue #163). */
export function DocPager({ route }: { route: string }) {
  const { prev, next } = docPager(route);
  if (prev === null && next === null) return null;
  return (
    <nav
      aria-label={t("pager.label")}
      className="mt-12 grid grid-cols-1 gap-3 border-t border-border pt-6 sm:grid-cols-2"
    >
      {prev !== null ? (
        <Link
          to={prev.route}
          className="group flex flex-col gap-1 rounded-lg border border-border p-4 transition-colors hover:border-accent/50 hover:bg-muted/50"
        >
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ArrowLeft aria-hidden="true" className="size-3.5" />
            {t("pager.previous")}
          </span>
          <span className="text-sm font-medium group-hover:text-accent">{prev.title}</span>
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
      {next !== null ? (
        <Link
          to={next.route}
          className="group flex flex-col items-end gap-1 rounded-lg border border-border p-4 text-right transition-colors hover:border-accent/50 hover:bg-muted/50"
        >
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {t("pager.next")}
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </span>
          <span className="text-sm font-medium group-hover:text-accent">{next.title}</span>
        </Link>
      ) : (
        <span aria-hidden="true" />
      )}
    </nav>
  );
}
