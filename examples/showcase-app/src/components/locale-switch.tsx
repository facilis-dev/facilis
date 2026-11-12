import { ChevronDown } from "lucide-react";
import { LOCALES, t, useLocale } from "../lib/i18n.tsx";
import { cn } from "../lib/utils.ts";

const LABELS = { en: "locale.en", it: "locale.it" } as const;

/** Persists the language choice; every visible string comes from the selected catalogue. */
export function LocaleSwitch({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();

  return (
    <label className={cn("relative inline-flex items-center", className)}>
      <span className="sr-only">{t("locale.label")}</span>
      <select
        className="h-9 cursor-pointer appearance-none rounded-lg border border-border bg-transparent py-0 pr-8 pl-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        value={locale}
        onChange={(event) => {
          const next = event.currentTarget.value;
          if (next === "en" || next === "it") setLocale(next);
        }}
      >
        {LOCALES.map((value) => (
          <option key={value} value={value}>
            {t(LABELS[value])}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 size-4 text-muted-foreground"
      />
    </label>
  );
}
