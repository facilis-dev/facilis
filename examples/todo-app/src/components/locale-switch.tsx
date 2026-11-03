import { t } from "@facilis/core/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";
import { LOCALES, useLocale } from "../lib/i18n.tsx";

const LABELS = { en: "locale.en", it: "locale.it" } as const;

/**
 * Persists the user's language choice. The catalogue keys are flat, so the option labels are
 * ordinary locale.* keys rather than a second translation lookup.
 */
export function LocaleSwitch() {
  const { locale, setLocale } = useLocale();
  const items = { en: t(LABELS.en), it: t(LABELS.it) };

  return (
    <Select
      items={items}
      value={locale}
      onValueChange={(next) => {
        if (next === "en" || next === "it") setLocale(next);
      }}
    >
      <SelectTrigger size="sm" aria-label={t("locale.label")} className="min-w-24">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {LOCALES.map((value) => (
          <SelectItem key={value} value={value}>
            {t(LABELS[value])}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
