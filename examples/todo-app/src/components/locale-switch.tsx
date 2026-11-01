import { Select } from "@facilis/ui";
import { t } from "@facilis/core/i18n";
import { LOCALES, useLocale } from "../lib/i18n.tsx";

/**
 * Persists the user's language choice. The catalogue keys are flat, so the option labels are
 * ordinary locale.* keys rather than a second translation lookup.
 */
export function LocaleSwitch() {
  const { locale, setLocale } = useLocale();

  return (
    <Select
      aria-label={t("locale.label")}
      value={locale}
      onChange={(event) => {
        const next = event.target.value;
        if (next === "en" || next === "it") setLocale(next);
      }}
    >
      {LOCALES.map((value) => (
        <option key={value} value={value}>
          {t("locale." + value)}
        </option>
      ))}
    </Select>
  );
}
