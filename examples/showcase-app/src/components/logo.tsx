import { t } from "../lib/i18n.tsx";
import { cn } from "../lib/utils.ts";

/** The studio mark plus wordmark; the surrounding link supplies the destination. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("flex shrink-0 items-center gap-2.5 whitespace-nowrap", className)}>
      <span
        aria-hidden="true"
        className="grid size-9 place-items-center rounded-lg bg-primary font-serif text-lg leading-none font-semibold text-primary-foreground"
      >
        V
      </span>
      <span className="font-serif text-lg font-semibold tracking-tight">{t("app.title")}</span>
    </span>
  );
}
